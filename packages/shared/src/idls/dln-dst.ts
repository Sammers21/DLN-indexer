import type { Idl } from '@coral-xyz/anchor';

export const DLN_DST_IDL: Idl = {
  version: '1.2.1',
  name: 'dln_dst',
  instructions: [
    {
      name: 'fulfillOrder',
      accounts: [
        { name: 'takeOrderState', isMut: true, isSigner: false },
        { name: 'taker', isMut: true, isSigner: true },
        { name: 'takerWallet', isMut: true, isSigner: false },
        { name: 'receiverDst', isMut: true, isSigner: false },
        { name: 'authorizedSrcContract', isMut: false, isSigner: false },
        { name: 'takeOrderPatch', isMut: false, isSigner: false },
        { name: 'splTokenProgram', isMut: false, isSigner: false },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'unvalidatedOrder', type: { defined: 'Order' } },
        { name: 'orderId', type: { array: ['u8', 32] } },
        { name: 'unlockAuthority', type: { option: 'publicKey' } },
      ],
    },
    {
      name: 'cancelOrder',
      accounts: [
        { name: 'takeOrderState', isMut: true, isSigner: false },
        { name: 'authorizedSrcContract', isMut: false, isSigner: false },
        { name: 'canceler', isMut: true, isSigner: true },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [
        { name: 'unvalidatedOrder', type: { defined: 'Order' } },
        { name: 'orderId', type: { array: ['u8', 32] } },
      ],
    },
  ],
  accounts: [
    {
      name: 'takeOrderState',
      type: {
        kind: 'struct',
        fields: [
          { name: 'orderState', type: { defined: 'OrderTakeStatus' } },
          { name: 'sourceChainId', type: { array: ['u8', 32] } },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
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
      name: 'OrderTakeStatus',
      type: {
        kind: 'enum',
        variants: [
          {
            name: 'OldFulfilled',
            fields: [{ name: 'unlockAuthority', type: 'publicKey' }],
          },
          {
            name: 'SentUnlock',
            fields: [{ name: 'unlocker', type: 'publicKey' }],
          },
          {
            name: 'Cancelled',
            fields: [
              { name: 'canceler', type: 'publicKey' },
              { name: 'allowed_cancel_beneficiary_src', type: { option: 'bytes' } },
            ],
          },
          {
            name: 'SentCancel',
            fields: [{ name: 'canceler', type: 'publicKey' }],
          },
          {
            name: 'Fulfilled',
            fields: [
              { name: 'unlockAuthority', type: 'publicKey' },
              { name: 'orderId', type: { array: ['u8', 32] } },
            ],
          },
        ],
      },
    },
  ],
  events: [
    {
      name: 'Fulfilled',
      fields: [
        { name: 'orderId', type: { array: ['u8', 32] }, index: false },
        { name: 'taker', type: 'publicKey', index: false },
      ],
    },
    {
      name: 'SentUnlock',
      fields: [],
    },
    {
      name: 'SentOrderCancel',
      fields: [],
    },
    {
      name: 'OrderCancelled',
      fields: [],
    },
    {
      name: 'DecreaseTakeAmount',
      fields: [
        { name: 'orderId', type: { array: ['u8', 32] }, index: false },
        { name: 'orderTakeFinalAmount', type: 'u64', index: false },
      ],
    },
  ],
  errors: [],
};
