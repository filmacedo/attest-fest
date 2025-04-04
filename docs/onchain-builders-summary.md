# ✅ Project Summary

### 🔧 Project: Registry of Verified Onchain Builders

_Built using [Ethereum Attestation Service (EAS)](https://docs.attest.org)_

---

## 📐 EAS Schema Design

### 🧩 EAS Schema A: Verification Partner

```ts
{
  name: string,       // partner name (e.g., "Talent Protocol")
  url: string         // partner website or info URL
}
```

- Issued by: `attestations.talentprotocol.eth`
- Recipient: partner’s wallet address
- Purpose: defines who is authorized to issue builder attestations
- No expiration
- Revocable: ✅ Yes

---

### 🧩 EAS Schema B: Verified Builder Attestation

```ts
{
  isBuilder: boolean,         // to explicitly mark the credential
  context: string             // e.g. "Built the frontend for XYZ protocol"
}
```

- Issued by: a verified partner onchain (they need to connect a wallet)
- Recipient: builder’s wallet address (mandatory)
- References the verification partner’s UID via `refUID`
- No expiration
- Revocable: ✅ Yes

---

## 🧪 Test Deployment (Sepolia)

- ✅ Deployed schemas on Sepolia testnet
  - [Verification Partner Live Schema URL](https://sepolia.easscan.org/schema/view/0x0c25f92df9ba914668f7780e428a1b5238ae7441c765fbe8b7b528f8209ef4e3)
  - [Verified Builder Attestation Live Schema URL](https://sepolia.easscan.org/schema/view/0x597905068aedcde4321ceaf2c42e24d3bbe0af694159bececd686bf057ec7ea5)
- ✅ Issued sample attestations:
  - Verification Partner:
    - [talentprotocol.eth on EASScan](https://sepolia.easscan.org/attestation/view/0xa3b6b9b84a1309c23d0dd0980bc589619c5cb13e70df2f7cf75a29a96eb49d6a)
  - Builders:
    - [leal.eth on EASScan](https://sepolia.easscan.org/attestation/view/0xd2d90f9ea42231c618b63e28c1d433e741b40f657b009594b901302edb44c9bc)
    - [pcbo.eth on EASScan](https://sepolia.easscan.org/attestation/view/0x6dcc5c41b44e29ddc7465e4402514424c42772318a5ee4aa323d55d3378f2c73)

---

## 💻 Frontend: Registry Page

React, next.js, typescript, tailwind, shadcn/ui app built to:

- Fetch attestations via EAS GraphQL Subgraph (Sepolia)
  - show only attestations where isBuilder = True
- Parse and display:
  - Builder wallet or ENS
  - Context of verification
  - Verifier (attester address)
  - Date of issuance
  - Direct link to attestation on [EASScan](https://sepolia.easscan.org)
- Includes
  - dropdown to filter partners
  - search bar to search for builder wallet address or ENS

---

## 🔜 Next Steps

1. **Metadata Improvements**

   - ENS resolution
   - Profile enrichment using the [Talent Protocol API](https://docs.talentprotocol.com/docs/developers/talent-api/api-reference-v2/talent-profiles)

2. **Multi-Attestation Issuer UI**

   - Form to create multiple builder attestations at once
     - paste addresses and context (optional), separated by a comma (new addresses in a new line)
   - Auto-reference partner attestation UID (dropdown to selece with Partner)
   - isBuilder = True by default
   - Validate data before submission
     - Partner needs to connect wallet / sign message
   - Batch attestations for gas efficiency

3. **Mainnet Rollout**
   - Deploy schemas on Ethereum mainnet
