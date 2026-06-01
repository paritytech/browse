// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Store} from "../src/Store.sol";

contract DeployStore is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        Store store = new Store();

        vm.stopBroadcast();

        console.log("Store deployed to:", address(store));
    }
}
