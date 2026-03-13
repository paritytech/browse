import { getApps } from "./data";
import { renderApp } from "./ui";
import { setupDebugConsole } from "./debug";
import { setChainStatusCallback } from "./chain";
import "./style.css";

const root = document.querySelector("#app") as HTMLElement;
const { setApps, setLoading, setStatus } = renderApp(root);
setupDebugConsole(root);

setChainStatusCallback((msg) => setStatus(msg));
setLoading(true);
getApps((partialApps) => {
  // Progressive: show label-only cards as stores are scanned
  setApps(partialApps);
}).then((result) => {
  if (result.status === "ok" || result.status === "mock") {
    setApps(result.apps);
  } else {
    setStatus(result.message);
  }
});
