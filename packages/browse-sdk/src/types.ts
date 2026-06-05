// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 	http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

export const MODALITIES = ['app', 'widget', 'worker'] as const
export type Modality = (typeof MODALITIES)[number]

export type IconFormat = 'jpeg' | 'png'

export interface RootManifest {
  $v: 1
  displayName: string
  description: string
  icon: { cid: string; format: IconFormat }
}

export interface AppListing {
  label: string
  /**
   * IPFS CID for the queried modality.
   */
  contentHash: string
  manifest: RootManifest
}

/** A deployed registry, identified by its version. */
export interface Deployment {
  version: string
  address: `0x${string}`
}

export interface NetworkAddresses {
  /**
   * Deployed Publisher registries for this network, current first.
   *
   * https://github.com/paritytech/browse/blob/main/evm/src/Publisher.sol
   */
  PUBLISHER: readonly Deployment[]
  /** https://github.com/paritytech/dotns/blob/master/contracts/registrars/DotnsRegistrar.sol */
  REGISTRAR: `0x${string}`
  /** https://github.com/paritytech/dotns/blob/master/contracts/resolvers/DotnsContentResolver.sol */
  CONTENT_RESOLVER: `0x${string}`
  /** https://github.com/paritytech/dotns/blob/master/contracts/utils/Multicall3.sol */
  MULTICALL3: `0x${string}`
}
