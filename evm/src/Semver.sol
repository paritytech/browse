// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ISemver} from "./interfaces/ISemver.sol";

/// @title Semver
/// @notice A simple contract for managing major/minor/patch versions.
contract Semver is ISemver {
    // The major version.
    uint256 private immutable _major;

    // The minor version.
    uint256 private immutable _minor;

    // The patch version.
    uint256 private immutable _patch;

    /// @dev Creates a new Semver instance.
    /// @param major The major version.
    /// @param minor The minor version.
    /// @param patch The patch version.
    constructor(uint256 major, uint256 minor, uint256 patch) {
        _major = major;
        _minor = minor;
        _patch = patch;
    }

    /// @inheritdoc ISemver
    function version() external view returns (string memory) {
        return string(
            abi.encodePacked(
                Strings.toString(_major), ".",
                Strings.toString(_minor), ".",
                Strings.toString(_patch)
            )
        );
    }
}
