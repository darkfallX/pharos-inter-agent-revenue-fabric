// SPDX-License-Identifier: MIT-0
pragma solidity ^0.8.24;

/// @title SkillRevenueFabric
/// @notice On-chain registry of skills, contribution weights, perpetual royalties,
///         and Merkle-rooted payment proofs for the Pharos Revenue Fabric.
contract SkillRevenueFabric {
    struct Skill {
        address creator;
        uint256 contributionWeight; // basis points 1-10000
        uint256 royaltyBps;         // perpetual royalty basis points
        bytes32 successor;          // revenue inheritance target
        bool active;
    }

    mapping(bytes32 => Skill) public skills;
    mapping(bytes32 => bytes32[]) public dependencies;
    mapping(bytes32 => bytes32) public paymentProofs; // invocationId => merkleRoot
    mapping(address => uint256) public totalEarned;

    event SkillRegistered(
        bytes32 indexed skillId,
        address indexed creator,
        uint256 contributionWeight,
        uint256 royaltyBps
    );
    event SuccessorSet(bytes32 indexed skillId, bytes32 indexed successorId);
    event SkillClaimed(bytes32 indexed skillId, address indexed creator);
    event RoyaltyPaymentRecorded(
        bytes32 indexed invocationId,
        bytes32 indexed rootSkillId,
        uint256 totalAmount,
        bytes32 merkleRoot
    );

    error SkillAlreadyRegistered();
    error SkillNotFound();
    error InvalidWeight();
    error InvalidRoyalty();
    error NotCreator();
    error ArrayLengthMismatch();

    /// @notice Register a skill with a contribution weight and perpetual royalty rate.
    function registerSkill(
        bytes32 skillId,
        uint256 contributionWeight,
        bytes32[] calldata deps,
        uint256 royaltyBps
    ) external {
        if (skills[skillId].active) revert SkillAlreadyRegistered();
        if (contributionWeight == 0 || contributionWeight > 10000) revert InvalidWeight();
        if (royaltyBps > 2000) revert InvalidRoyalty();

        skills[skillId] = Skill({
            creator: msg.sender,
            contributionWeight: contributionWeight,
            royaltyBps: royaltyBps,
            successor: bytes32(0),
            active: true
        });

        dependencies[skillId] = deps;

        emit SkillRegistered(skillId, msg.sender, contributionWeight, royaltyBps);
    }

    /// @notice Set a successor skill for revenue inheritance.
    function setSuccessor(bytes32 skillId, bytes32 successorId) external {
        if (!skills[skillId].active) revert SkillNotFound();
        if (skills[skillId].creator != msg.sender) revert NotCreator();

        skills[skillId].successor = successorId;
        emit SuccessorSet(skillId, successorId);
    }

    /// @notice Bind msg.sender as a skill's payout creator. Binds an unregistered
    ///         skillId on first claim; a registered skill is re-bound only by its creator.
    function claimSkill(bytes32 skillId) external {
        Skill storage s = skills[skillId];
        if (!s.active) {
            s.creator = msg.sender;
            s.contributionWeight = 5000;
            s.royaltyBps = 500;
            s.active = true;
            emit SkillRegistered(skillId, msg.sender, 5000, 500);
        } else {
            if (s.creator != address(0) && s.creator != msg.sender) revert NotCreator();
            s.creator = msg.sender;
        }
        emit SkillClaimed(skillId, msg.sender);
    }

    /// @notice Resolve the effective creator, following the successor chain.
    function resolveCreator(bytes32 skillId) external view returns (address) {
        if (!skills[skillId].active) revert SkillNotFound();

        bytes32 current = skillId;
        uint256 guard = 0;
        while (skills[current].successor != bytes32(0) && guard < 16) {
            current = skills[current].successor;
            guard++;
        }
        return skills[current].creator;
    }

    function getSkill(bytes32 skillId)
        external
        view
        returns (
            address creator,
            uint256 contributionWeight,
            uint256 royaltyBps,
            bytes32 successor,
            bool active
        )
    {
        Skill memory s = skills[skillId];
        return (s.creator, s.contributionWeight, s.royaltyBps, s.successor, s.active);
    }

    function getDependencies(bytes32 skillId) external view returns (bytes32[] memory) {
        return dependencies[skillId];
    }

    /// @notice Record a royalty payment batch and store its Merkle provenance root.
    function recordRoyaltyPayment(
        bytes32 invocationId,
        bytes32 rootSkillId,
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes32 merkleRoot
    ) external {
        if (recipients.length != amounts.length) revert ArrayLengthMismatch();

        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
            totalEarned[recipients[i]] += amounts[i];
        }

        paymentProofs[invocationId] = merkleRoot;
        emit RoyaltyPaymentRecorded(invocationId, rootSkillId, total, merkleRoot);
    }

    function verifyPaymentProof(bytes32 invocationId, bytes32 merkleRoot) external view returns (bool) {
        return paymentProofs[invocationId] == merkleRoot;
    }
}
