import type { Idl } from '@coral-xyz/anchor';

export const DLN_SRC_IDL: Idl = {
  version: '3.0.0',
  name: 'dln_src',
  instructions: [
    {
      name: 'createOrder',
      accounts: [
        { name: 'maker', isMut: true, isSigner: true },
        { name: 'state', isMut: false, isSigner: false },
        { name: 'tokenMint', isMut: false, isSigner: false },
        { name: 'giveOrderState', isMut: true, isSigner: false },
        { name: 'authorizedNativeSender', isMut: false, isSigner: false },
        { name: 'makerWallet', isMut: true, isSigner: false },
        { name: 'giveOrderWallet', isMut: true, isSigner: false },
        { name: 'nonceMaster', isMut: true, isSigner: false },
        { name: 'feeLedgerWallet', isMut: true, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
        { name: 'splTokenProgram', isMut: false, isSigner: false },
        { name: 'associatedSplTokenProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'orderArgs', type: { defined: 'CreateOrderArgs' } },
        { name: 'affiliateFee', type: { option: { defined: 'AffiliateFee' } } },
        { name: 'referralCode', type: { option: 'u32' } },
      ],
    },
    {
      name: 'createOrderWithNonce',
      accounts: [
        { name: 'maker', isMut: true, isSigner: true },
        { name: 'state', isMut: false, isSigner: false },
        { name: 'tokenMint', isMut: false, isSigner: false },
        { name: 'giveOrderState', isMut: true, isSigner: false },
        { name: 'authorizedNativeSender', isMut: false, isSigner: false },
        { name: 'makerWallet', isMut: true, isSigner: false },
        { name: 'giveOrderWallet', isMut: true, isSigner: false },
        { name: 'nonceMaster', isMut: true, isSigner: false },
        { name: 'feeLedgerWallet', isMut: true, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
        { name: 'splTokenProgram', isMut: false, isSigner: false },
        { name: 'associatedSplTokenProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'orderArgs', type: { defined: 'CreateOrderArgs' } },
        { name: 'affiliateFee', type: { option: { defined: 'AffiliateFee' } } },
        { name: 'referralCode', type: { option: 'u32' } },
        { name: 'nonce', type: 'u64' },
        { name: 'metadata', type: 'bytes' },
      ],
    },
  ],
  accounts: [],
  types: [
    {
      name: 'Order',
      type: {
        kind: 'struct',
        fields: [
          { name: 'makerOrderNonce', type: 'u64' },
          { name: 'makerSrc', type: 'bytes' },
          { name: 'give', type: { defined: 'Offer' } },
          { name: 'take', type: { defined: 'Offer' } },
          { name: 'receiverDst', type: 'bytes' },
          { name: 'givePatchAuthoritySrc', type: 'bytes' },
          { name: 'orderAuthorityAddressDst', type: 'bytes' },
          { name: 'allowedTakerDst', type: { option: 'bytes' } },
          { name: 'allowedCancelBeneficiarySrc', type: { option: 'bytes' } },
          { name: 'externalCall', type: { option: { defined: 'ExternalCallParams' } } },
        ],
      },
    },
    {
      name: 'Offer',
      type: {
        kind: 'struct',
        fields: [
          { name: 'chainId', type: { array: ['u8', 32] } },
          { name: 'tokenAddress', type: 'bytes' },
          { name: 'amount', type: { array: ['u8', 32] } },
        ],
      },
    },
    {
      name: 'ExternalCallParams',
      type: {
        kind: 'struct',
        fields: [{ name: 'externalCallShortcut', type: { array: ['u8', 32] } }],
      },
    },
    {
      name: 'CreateOrderArgs',
      type: {
        kind: 'struct',
        fields: [
          { name: 'giveOriginalAmount', type: 'u64' },
          { name: 'take', type: { defined: 'Offer' } },
          { name: 'receiverDst', type: 'bytes' },
          { name: 'externalCall', type: { option: 'bytes' } },
          { name: 'givePatchAuthoritySrc', type: 'publicKey' },
          { name: 'allowedCancelBeneficiarySrc', type: { option: 'publicKey' } },
          { name: 'orderAuthorityAddressDst', type: 'bytes' },
          { name: 'allowedTakerDst', type: { option: 'bytes' } },
        ],
      },
    },
    {
      name: 'AffiliateFee',
      type: {
        kind: 'struct',
        fields: [
          { name: 'beneficiary', type: 'publicKey' },
          { name: 'amount', type: 'u64' },
        ],
      },
    },
  ],
  events: [
    {
      name: 'CreatedOrder',
      fields: [
        { name: 'order', type: { defined: 'Order' }, index: false },
        { name: 'fixFee', type: 'u64', index: false },
        { name: 'percentFee', type: 'u64', index: false },
      ],
    },
    {
      name: 'CreatedOrderId',
      fields: [{ name: 'orderId', type: { array: ['u8', 32] }, index: false }],
    },
    {
      name: 'ClaimedOrderCancel',
      fields: [],
    },
    {
      name: 'ClaimedUnlock',
      fields: [],
    },
    {
      name: 'IncreasedGiveAmount',
      fields: [
        { name: 'orderGiveFinalAmount', type: 'u64', index: false },
        { name: 'finalPercentFee', type: 'u64', index: false },
      ],
    },
  ],
  errors: [],
};
