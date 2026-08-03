export type PublicDocumentFailure = "expired" | "invalid" | "revoked" | "unavailable";

export interface PublicDocumentFailureCopy {
  detail: string;
  eyebrow: string;
  title: string;
}

const failures: Record<PublicDocumentFailure, PublicDocumentFailureCopy> = {
  expired: {
    detail:
      "For your security, document links are available for a limited time. Ask our team for a fresh link.",
    eyebrow: "Link expired",
    title: "This secure link has expired.",
  },
  invalid: {
    detail:
      "Check that the full link was copied correctly. If it still doesn’t work, our team can send a new one.",
    eyebrow: "Link not recognized",
    title: "We couldn’t find this document.",
  },
  revoked: {
    detail:
      "This link was turned off by Lincoln Dirt & Gravel. Contact our team if you still need the document.",
    eyebrow: "Access removed",
    title: "This secure link was revoked.",
  },
  unavailable: {
    detail:
      "The document may still be processing or is no longer available. Please try again later or contact our team.",
    eyebrow: "Document unavailable",
    title: "This file isn’t ready to download.",
  },
};

export function publicDocumentFailure(code: string | undefined): PublicDocumentFailureCopy {
  if (code === "PUBLIC_LINK_EXPIRED") return failures.expired;
  if (code === "PUBLIC_LINK_REVOKED") return failures.revoked;
  if (code === "DOCUMENT_UNAVAILABLE") return failures.unavailable;
  return failures.invalid;
}
