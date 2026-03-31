import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const StoreModule = buildModule("Store", (m) => {
  const store = m.contract("Store");
  return { store };
});

export default StoreModule;
