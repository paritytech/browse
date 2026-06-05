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

export { BrowseSdk, createBrowseSdk } from './sdk.js'

export {
  isKnownGenesis,
  KNOWN_NETWORKS,
  PASEO_ASSET_HUB_NEXT_V2_GENESIS,
  PASEO_ASSET_HUB_V1_GENESIS,
  PREVIEWNET_ASSET_HUB_GENESIS,
  selectNetwork,
  SUMMIT_ASSET_HUB_GENESIS
} from './config.js'
export type { NetworkConfig, NetworkGenesis } from './config.js'

export { parseRootManifest } from './manifest.js'

export { MODALITIES } from './types.js'
export type {
  AppListing,
  IconFormat,
  Modality,
  NetworkAddresses,
  RootManifest
} from './types.js'

export {
  decodeAddress,
  decodeAddressArray,
  decodeAggregate3Result,
  decodeAttestationLabel,
  decodeBool,
  decodeBytes,
  decodeBytes32Array,
  decodeIpfsContenthash,
  decodeString,
  decodeStringArray,
  decodeUint64,
  encodeAggregate3,
  encodeAttestationLabel,
  encodeContenthash,
  encodeCountByRecipientAndSchema,
  encodeGetLabels,
  encodeGetLabelStores,
  encodeGetPublished,
  encodeIsActiveAny,
  encodeLabelOf,
  encodeNodeOwner,
  encodeOwner,
  encodePublishedCount,
  encodeText,
  labelhashToTokenId,
  namehash,
  nodeToSubject,
  tryDecode
} from './abi/index.js'
export type { AggregateResult, MulticallTarget } from './abi/index.js'
