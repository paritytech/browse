import { getApps } from "./data";
import { renderApp } from "./ui";
import "./style.css";

const root = document.querySelector("#app") as HTMLElement;
const { setApps, setLoading } = renderApp(root);

setLoading(true);
getApps().then((apps) => setApps(apps));
