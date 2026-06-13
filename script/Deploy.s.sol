// SPDX-License-Identifier: MIT-0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {SkillRevenueFabric} from "../contracts/SkillRevenueFabric.sol";

/**
 * @title Deploy SkillRevenueFabric
 * @notice Foundry deployment script for Pharos networks.
 *
 * Usage (mainnet):
 *   forge script script/Deploy.s.sol:DeploySkillRevenueFabric \
 *     --rpc-url pharos-mainnet \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast
 *
 * Usage (Atlantic testnet):
 *   forge script script/Deploy.s.sol:DeploySkillRevenueFabric \
 *     --rpc-url pharos-atlantic \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast
 */
contract DeploySkillRevenueFabric is Script {
    function run() external returns (address deployed) {
        vm.startBroadcast();
        deployed = address(new SkillRevenueFabric());
        vm.stopBroadcast();
    }
}