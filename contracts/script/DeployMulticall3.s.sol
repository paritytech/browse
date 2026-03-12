// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Multicall3} from "../src/Multicall3.sol";

contract DeployMulticall3 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        Multicall3 multicall = new Multicall3();

        vm.stopBroadcast();

        console.log("Multicall3 deployed to:", address(multicall));
    }
}
