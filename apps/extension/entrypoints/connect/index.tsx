import "@gleam/app/src/app.css";
import { runtimePort } from "@/src/adapters/runtime";
import { mountRoot } from "@/src/mount-root";
import { ConnectRoot } from "./src/ConnectRoot";

const device = new URLSearchParams(window.location.search).get("device");

mountRoot(<ConnectRoot device={device} runtime={runtimePort} />);
