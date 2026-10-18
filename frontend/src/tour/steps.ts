export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TourStep {
  /** Value of the target element's `data-tour` attribute. Omit for a centered step. */
  target?: string;
  title: string;
  description: string;
  placement?: TourPlacement;
}

export type TourRole = 'issuer' | 'holder';

export interface TourPath {
  id: TourRole;
  label: string;
  steps: TourStep[];
}

export const ISSUER_TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to your issuer dashboard',
    description:
      'This quick tour shows you how to create a decentralized identifier (DID) and issue your first verifiable credential. You can skip at any time and restart the tour later from the help menu.',
    placement: 'center',
  },
  {
    target: 'create-did',
    title: 'Create your DID',
    description:
      'Start here. A DID is your on-chain identity. Click "Create DID" to generate and register your identifier before issuing any credentials.',
    placement: 'bottom',
  },
  {
    target: 'did-status',
    title: 'Check your DID status',
    description:
      'Once submitted, your DID is registered on-chain. This panel shows the current status and the resolved DID document.',
    placement: 'bottom',
  },
  {
    target: 'issue-credential',
    title: 'Issue a credential',
    description:
      'With a DID in place, open the credential form to issue a verifiable credential to a holder. Fill in the subject, claims, and expiry.',
    placement: 'left',
  },
  {
    target: 'credential-form',
    title: 'Fill in the credential details',
    description:
      'Enter the holder address and the claims to attest. Review the schema before signing — the credential is signed with your DID key.',
    placement: 'left',
  },
  {
    target: 'credential-list',
    title: 'Track issued credentials',
    description:
      'Every credential you issue appears here. You can revoke or inspect a credential at any time from this list.',
    placement: 'top',
  },
  {
    title: "You're ready to issue",
    description:
      'That completes the issuer tour. Restart it anytime from the help menu, or explore the docs to learn more about credential schemas.',
    placement: 'center',
  },
];

export const HOLDER_TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to your holder wallet',
    description:
      'This quick tour shows you how to resolve a DID and verify a credential you have received. You can skip at any time and restart the tour later from the help menu.',
    placement: 'center',
  },
  {
    target: 'resolve-did',
    title: 'Resolve a DID',
    description:
      'Paste a DID or issuer address here to look up its DID document. Resolving confirms the issuer identity before you trust a credential.',
    placement: 'bottom',
  },
  {
    target: 'did-document',
    title: 'Inspect the DID document',
    description:
      'The resolved document lists the issuer’s verification methods and services. Check that the key used to sign your credential is present.',
    placement: 'bottom',
  },
  {
    target: 'verify-credential',
    title: 'Verify a credential',
    description:
      'Open the verification panel to check a credential’s signature, issuer, and expiry. Verification is done locally against the resolved DID.',
    placement: 'left',
  },
  {
    target: 'credential-details',
    title: 'Review the credential',
    description:
      'Confirm the subject, claims, and validity window match what you expect. A green result means the credential is valid and untampered.',
    placement: 'left',
  },
  {
    target: 'credential-wallet',
    title: 'Your credentials',
    description:
      'Verified credentials are stored in your wallet. You can present them to verifiers or remove them at any time.',
    placement: 'top',
  },
  {
    title: "You're all set",
    description:
      'That completes the holder tour. Restart it anytime from the help menu, or explore the docs to learn more about verifying credentials.',
    placement: 'center',
  },
];

export const TOUR_PATHS: Record<TourRole, TourPath> = {
  issuer: {
    id: 'issuer',
    label: 'Issuer tour',
    steps: ISSUER_TOUR_STEPS,
  },
  holder: {
    id: 'holder',
    label: 'Holder tour',
    steps: HOLDER_TOUR_STEPS,
  },
};

/**
 * Select the tour step list for the given role.
 * Falls back to the holder path for unknown or missing roles.
 */
export function getTourSteps(role?: string | null): TourStep[] {
  const normalized = (role ?? '').toLowerCase();
  if (normalized === 'issuer') {
    return ISSUER_TOUR_STEPS;
  }
  return HOLDER_TOUR_STEPS;
}

/**
 * Select the full tour path (id, label, steps) for the given role.
 * Falls back to the holder path for unknown or missing roles.
 */
export function getTourPath(role?: string | null): TourPath {
  const normalized = (role ?? '').toLowerCase();
  if (normalized === 'issuer') {
    return TOUR_PATHS.issuer;
  }
  return TOUR_PATHS.holder;
}