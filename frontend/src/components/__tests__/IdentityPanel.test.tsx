import renderer from "react-test-renderer";
import IdentityPanel from "../IdentityPanel";
import { connectedWallet, connectingWallet, disconnectedWallet, erroredWallet } from "./fixtures";

describe("IdentityPanel snapshots", () => {
  it.each([
    ["disconnected", disconnectedWallet],
    ["connecting", connectingWallet],
    ["connected", connectedWallet],
    ["error", erroredWallet],
  ])("renders %s state", (_label, wallet) => {
    expect(renderer.create(<IdentityPanel wallet={wallet} />).toJSON()).toMatchSnapshot();
  });
});
