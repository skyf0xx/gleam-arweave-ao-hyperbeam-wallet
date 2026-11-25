import App from "@gleam/app/src/App.tsx";
import { createExtensionAppPlatform } from "@/src/adapters/app-platform";
import { mountRoot } from "@/src/mount-root";
import "@gleam/app/src/app.css";

mountRoot(<App layout="popup" />, createExtensionAppPlatform("popup"));
