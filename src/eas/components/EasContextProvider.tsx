import {
  EAS,
  SchemaEncoder,
  SchemaRegistry,
} from "@ethereum-attestation-service/eas-sdk";
import React, { ReactNode, useEffect, useState } from "react";
import {
  createMultiAttestRequest,
  encodeRow,
  processRecipient,
  shouldIncludeRow,
} from "../utils/encodeCsv";
import { useAccount, usePublicClient } from "wagmi";

import { EasContext } from "../types/eas-context-value.type";
import { SchemaField } from "../types/schema-field.type";
import { isSchemaFieldTypeName } from "../utils/isSchemaFieldTypeName";
import { parse } from "csv-parse/sync";
import { plausible } from "../../main";
import { useEasConfig } from "../hooks/useEasConfig";
import { useEthersProvider } from "../../ethers/hooks/useEthersProvider";
import { useEthersSigner } from "../../ethers/hooks/useEthersSigner";
import { useSafe } from "../../safe/hooks/useSafe";
import { useStateStore } from "../../zustand/hooks/useStateStore";
import {
  OperationType,
  SafeTransactionDataPartial,
} from "@safe-global/types-kit";

export const ReactEasContext = React.createContext<EasContext | undefined>(
  undefined,
);

type EasProviderProps = {
  schemaUid: string;
  children: ReactNode;
};

export const EasContextProvider: React.FC<EasProviderProps> = ({
  schemaUid,
  children,
}: EasProviderProps) => {
  // Hooks
  const { safeAddress, safe, safeApiKit } = useSafe();
  const { chain } = useAccount();
  const easConfig = useEasConfig(chain?.id);
  const rpcProvider = useEthersProvider({ chainId: chain?.id });
  const rpcSigner = useEthersSigner({ chainId: chain?.id });
  const publicClient = usePublicClient({ chainId: 1 });

  // Global state
  const csv = useStateStore((state) => state.csv);
  const includeRefUid = useStateStore((state) => state.includeRefUid);

  // Local state
  const [state, setState] = useState<EasContext>({ schemaUid });

  function loadSchemaRecord() {
    if (!easConfig || !rpcProvider || !schemaUid) {
      return;
    }
    void (async () => {
      setState((prev) => ({
        ...prev,
        schemaError: undefined,
        schemaRecordIsLoading: true,
        schemaRecordError: undefined,
      }));
      try {
        const schemaRegistry = new SchemaRegistry(easConfig.registryAddress);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schemaRegistry.connect(rpcProvider as any);
        if (!schemaUid) {
          return;
        }
        const schemaRecord = await schemaRegistry.getSchema({
          uid: schemaUid,
        });
        setState((prev) => ({
          ...prev,
          schemaRecord: schemaRecord,
          schemaRecordIsLoading: false,
        }));
      } catch (err) {
        console.error(err);
        setState((prev) => ({
          ...prev,
          schemaRecord: undefined,
          schemaRecordIsLoading: false,
          schemaRecordError: err as Error,
        }));
      }
    })();
  }

  function createSchemaFromRecord() {
    if (!state.schemaRecord) {
      return;
    }
    const schema: SchemaField[] = [];
    state.schemaRecord.schema.split(",").forEach((field) => {
      const [type, name] = field.trim().split(" ");
      if (isSchemaFieldTypeName(type)) {
        schema.push({ name, type });
      } else {
        const err = new Error(`Invalid type name: ${type}`);
        console.error(err);
        setState((prev) => ({ ...prev, schemaError: err }));
      }
    });
    if (includeRefUid) {
      schema.push({ name: "refUID", type: "bytes32" });
    }
    schema.push({ name: "recipient", type: "address" });
    setState((prev) => ({
      ...prev,
      schema,
    }));
  }

  function initSchemaEncoder() {
    if (!state.schemaRecord?.schema) return;
    try {
      const schemaEncoder = new SchemaEncoder(state.schemaRecord?.schema);
      setState((prev) => ({ ...prev, schemaEncoder }));
    } catch (err) {
      console.error(
        `Unable to create schema encoder for schema: "${state.schemaRecord?.schema}"`,
      );
      console.error(err);
      setState((prev) => ({ ...prev, schemaEncoderError: err as Error }));
    }
  }

  function parseCsv(csv: string) {
    return parse(csv, {
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
    });
  }

  const createSafeAttestationsTransaction = async (): Promise<void> => {
    try {
      if (
        !rpcSigner ||
        !safeAddress ||
        !safe ||
        !safeApiKit ||
        !state.schemaEncoder ||
        !state.schema ||
        !easConfig ||
        !publicClient ||
        !chain?.id ||
        !state.schemaRecord?.revocable
      ) {
        throw new Error("Missing signer, safe, safeApiKit or ethersAdapter");
      }

      setState((prev) => ({
        ...prev,
        safeTransactionState: {
          status: "creating",
        },
      }));

      const eas = new EAS(easConfig.address);
      eas.connect(rpcSigner);

      const requestData = [];
      const parsedCsv: string[][] = parseCsv(csv);

      for (const row of parsedCsv) {
        if (!shouldIncludeRow(row, state.schema)) {
          continue;
        }

        const encodedData = encodeRow(row, state.schema, state.schemaEncoder);

        const data = {
          recipient: await processRecipient(row[row.length - 1], publicClient),
          expirationTime: 0n,
          revocable: state.schemaRecord.revocable,
          refUID: includeRefUid
            ? row[row.length - 2]
            : "0x0000000000000000000000000000000000000000000000000000000000000000",
          data: encodedData,
          value: 0n,
        };

        requestData.push(data);
      }

      const txData: SafeTransactionDataPartial = {
        to: easConfig.address,
        value: "0",
        data: eas.contract.interface.encodeFunctionData("multiAttest", [
          [
            {
              schema: schemaUid,
              data: requestData,
            },
          ],
        ]),
        operation: OperationType.Call,
      };

      const transaction = await safe.createTransaction({
        transactions: [txData],
      });

      const signerAddress = await rpcSigner.getAddress();
      const txHash = await safe.getTransactionHash(transaction);

      setState((prev) => ({
        ...prev,
        safeTransactionState: {
          status: "signing",
          txHash,
        },
      }));

      const signedTransaction = await safe.signTransaction(transaction);

      const signature = signedTransaction.getSignature(signerAddress);
      if (!signature) {
        throw new Error("Signing transaction failed");
      }

      // Propose transaction to the service
      await safeApiKit.proposeTransaction({
        safeAddress,
        safeTransactionData: transaction.data,
        safeTxHash: txHash,
        senderAddress: signerAddress,
        senderSignature: signature.data,
      });

      console.log("Proposed a transaction with Safe:", safeAddress);
      console.log("- Transaction hash:", txHash);
      console.log("- Signer address:", signerAddress);
      console.log("- Signature:", transaction.data);

      plausible.trackEvent("attestation-created", {
        props: {
          chain: chain?.id,
          wallet: "safe",
          schema: schemaUid,
          attestationCount: requestData.length,
        },
      });

      setState((prev) => ({
        ...prev,
        safeTransactionState: {
          status: "created",
          txHash,
          signature,
        },
      }));
    } catch (e) {
      setState((prev) => ({
        ...prev,
        safeTransactionState: {
          status: "error",
          error: e as Error,
        },
      }));
      console.error("Error creating transaction", e);
    }
  };

  const createAttestations = async (): Promise<void> => {
    try {
      if (
        !state.schemaEncoder ||
        !state.schema ||
        !easConfig ||
        !rpcSigner ||
        !publicClient ||
        !chain?.id ||
        !state.schemaRecord?.revocable
      ) {
        throw new Error(
          "Missing schemaEncoder, schema, easConfig, rpcSigner or publicClient",
        );
      }

      setState((prev) => ({
        ...prev,
        transactionStatus: "creating",
      }));

      const request = await createMultiAttestRequest(
        csv,
        state.schemaUid,
        state.schema,
        state.schemaEncoder,
        state.schemaRecord.revocable,
        publicClient,
      );

      console.log("Creating attestations", request);
      const eas = new EAS(easConfig.address);
      eas.connect(rpcSigner);

      console.log("EAS initialized");
      console.log("Creating attestations", request);

      setState((prev) => ({
        ...prev,
        transactionStatus: "attesting",
      }));

      const transaction = await eas.multiAttest([request]);

      plausible.trackEvent("attestation-created", {
        props: {
          chain: chain?.id,
          wallet: "safe",
          schema: schemaUid,
          attestationCount: request.data.length,
        },
      });

      console.log("Attestation transaction created", transaction);
      console.log("Waiting for transaction to be mined");

      setState((prev) => ({
        ...prev,
        transactionStatus: "wait_uid",
        transaction,
      }));

      const uid = await transaction.wait();

      console.log("Transaction mined.");
      console.log("Attestation UIDs", uid);

      setState((prev) => ({
        ...prev,
        transactionStatus: "success",
        attestationUids: uid,
      }));
    } catch (e) {
      setState((prev) => ({
        ...prev,
        transactionStatus: "error",
        transactionError: e,
      }));
      console.error("Error creating transaction", e);
    }
  };

  const resetTransactions = () => {
    setState((prev) => ({
      ...prev,
      safeTransactionState: undefined,
      transaction: undefined,
      transactionError: undefined,
      transactionStatus: undefined,
      attestationUids: undefined,
    }));
  };

  // useEffect(initEas, [easConfig?.address]);
  useEffect(loadSchemaRecord, [easConfig, rpcProvider, schemaUid]);
  useEffect(createSchemaFromRecord, [state.schemaRecord, includeRefUid]);
  useEffect(initSchemaEncoder, [state.schemaRecord?.schema]);

  const context: EasContext = {
    ...state,
    createSafeAttestationsTransaction,
    createAttestations,
    resetTransactions,
  };

  return (
    <ReactEasContext.Provider value={context}>
      {children}
    </ReactEasContext.Provider>
  );
};
