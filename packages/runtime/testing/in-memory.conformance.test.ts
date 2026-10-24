import { Keyring } from "@gleam/core/signer";
import {
  describeApprovalPresenterPort,
  describeSessionKeyStorePort,
  describeStoragePort,
  describeTimerPort,
} from "./index";
import { InMemoryApprovalPresenter, InMemoryStorage, InMemoryTimer } from "./in-memory-platform";

describeStoragePort("in-memory", async () => ({ port: new InMemoryStorage() }));

describeSessionKeyStorePort("in-memory Keyring", async () => ({ port: new Keyring() }));

describeTimerPort("in-memory", async () => {
  const timer = new InMemoryTimer();
  return {
    port: timer,
    fire: async (name) => timer.fire(name),
    schedule: async (name) => timer.schedule(name),
  };
});

describeApprovalPresenterPort("in-memory", async () => {
  const presenter = new InMemoryApprovalPresenter();
  return {
    port: presenter,
    userDismiss: (id) => presenter.userDismiss(id),
    isShowing: async (id) => presenter.isShowing(id),
  };
});
