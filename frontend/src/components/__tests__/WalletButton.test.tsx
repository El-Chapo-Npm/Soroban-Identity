import renderer from "react-test-renderer";
import WalletButton from "../WalletButton";
import { connectedWallet, connectingWallet, disconnectedWallet, erroredWallet } from "./fixtures";

describe("WalletButton snapshots", () => {
  it.each([
    ["disconnected", disconnectedWallet],
    ["connecting", connectingWallet],
    ["connected", connectedWallet],
    ["error", erroredWallet],
  ])("renders %s state", (_label, wallet) => {
    expect(renderer.create(<WalletButton wallet={wallet} />).toJSON()).toMatchSnapshot();
  });
});
