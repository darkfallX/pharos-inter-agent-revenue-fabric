/**
 * SkillRevenueFabric contract ABI.
 * On-chain registry for skill dependencies, contribution weights, and perpetual royalties.
 */

export const SKILL_REVENUE_FABRIC_ABI = [
  {
    type: 'event',
    name: 'SkillRegistered',
    inputs: [
      { name: 'skillId', type: 'bytes32', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'contributionWeight', type: 'uint256', indexed: false },
      { name: 'royaltyBps', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SuccessorSet',
    inputs: [
      { name: 'skillId', type: 'bytes32', indexed: true },
      { name: 'successorId', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'RoyaltyPaymentRecorded',
    inputs: [
      { name: 'invocationId', type: 'bytes32', indexed: true },
      { name: 'rootSkillId', type: 'bytes32', indexed: true },
      { name: 'totalAmount', type: 'uint256', indexed: false },
      { name: 'merkleRoot', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'registerSkill',
    inputs: [
      { name: 'skillId', type: 'bytes32' },
      { name: 'contributionWeight', type: 'uint256' },
      { name: 'dependencies', type: 'bytes32[]' },
      { name: 'royaltyBps', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setSuccessor',
    inputs: [
      { name: 'skillId', type: 'bytes32' },
      { name: 'successorId', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getSkill',
    inputs: [{ name: 'skillId', type: 'bytes32' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'contributionWeight', type: 'uint256' },
      { name: 'royaltyBps', type: 'uint256' },
      { name: 'successor', type: 'bytes32' },
      { name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDependencies',
    inputs: [{ name: 'skillId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'recordRoyaltyPayment',
    inputs: [
      { name: 'invocationId', type: 'bytes32' },
      { name: 'rootSkillId', type: 'bytes32' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'merkleRoot', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyPaymentProof',
    inputs: [
      { name: 'invocationId', type: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'resolveCreator',
    inputs: [{ name: 'skillId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
];
