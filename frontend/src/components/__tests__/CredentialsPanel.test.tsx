import renderer from "react-test-renderer";
import CredentialsPanel from "../CredentialsPanel";
import { connectedWallet, connectingWallet, disconnectedWallet, erroredWallet } from "./fixtures";

describe("CredentialsPanel snapshots", () => {
  it.each([
    ["disconnected", disconnectedWallet],
    ["connecting", connectingWallet],
    ["connected", connectedWallet],
    ["error", erroredWallet],
  ])("renders %s state", (_label, wallet) => {
    expect(renderer.create(<CredentialsPanel wallet={wallet} />).toJSON()).toMatchSnapshot();
  });
});
