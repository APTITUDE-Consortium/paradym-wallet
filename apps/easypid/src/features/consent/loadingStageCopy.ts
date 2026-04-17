import type { ResolveCredentialOfferStage, ResolveCredentialRequestStage } from '@paradym/wallet-sdk'

type Translate = (descriptor: { id: string; message: string; comment?: string }) => string

type LoadingCopy = {
  title: string
  description: string
}

export const getPresentationLoadingCopy = (
  t: Translate,
  stage?: ResolveCredentialRequestStage
): LoadingCopy => {
  switch (stage) {
    case 'resolving_request':
      return {
        title: t({
          id: 'presentation.loading.resolvingRequest.title',
          message: 'Opening request',
          comment: 'Title shown while the wallet loads an OpenID4VP request',
        }),
        description: t({
          id: 'presentation.loading.resolvingRequest.description',
          message: 'Loading the request from the relying party.',
          comment: 'Description shown while the wallet loads an OpenID4VP request',
        }),
      }
    case 'verifying_request':
      return {
        title: t({
          id: 'presentation.loading.verifyingRequest.title',
          message: 'Checking request',
          comment: 'Title shown while the wallet verifies an OpenID4VP request',
        }),
        description: t({
          id: 'presentation.loading.verifyingRequest.description',
          message: 'Verifying the request signature and contents.',
          comment: 'Description shown while the wallet verifies an OpenID4VP request',
        }),
      }
    case 'resolving_trust':
      return {
        title: t({
          id: 'presentation.loading.resolvingTrust.title',
          message: 'Checking organization',
          comment: 'Title shown while the wallet resolves trust for the relying party',
        }),
        description: t({
          id: 'presentation.loading.resolvingTrust.description',
          message: 'Verifying who is asking for your data.',
          comment: 'Description shown while the wallet resolves trust for the relying party',
        }),
      }
    case 'matching_credentials':
      return {
        title: t({
          id: 'presentation.loading.matchingCredentials.title',
          message: 'Matching credentials',
          comment: 'Title shown while the wallet matches credentials to the request',
        }),
        description: t({
          id: 'presentation.loading.matchingCredentials.description',
          message: 'Finding the credentials that can satisfy this request.',
          comment: 'Description shown while the wallet matches credentials to the request',
        }),
      }
    default:
      return {
        title: t({
          id: 'loadingRequestSlide.title',
          message: 'Please wait',
          comment: 'Title shown while request details are being loaded',
        }),
        description: t({
          id: 'loadingRequestSlide.description',
          message: 'Fetching information',
          comment: 'Description shown while request details are being loaded',
        }),
      }
  }
}

export const getIssuanceLoadingCopy = (t: Translate, stage?: ResolveCredentialOfferStage): LoadingCopy => {
  switch (stage) {
    case 'resolving_offer':
      return {
        title: t({
          id: 'issuance.loading.resolvingOffer.title',
          message: 'Opening offer',
          comment: 'Title shown while the wallet loads a credential offer',
        }),
        description: t({
          id: 'issuance.loading.resolvingOffer.description',
          message: 'Loading the credential offer from the issuer.',
          comment: 'Description shown while the wallet loads a credential offer',
        }),
      }
    case 'resolving_authorization':
      return {
        title: t({
          id: 'issuance.loading.resolvingAuthorization.title',
          message: 'Connecting to issuer',
          comment: 'Title shown while the wallet prepares issuer authorization',
        }),
        description: t({
          id: 'issuance.loading.resolvingAuthorization.description',
          message: 'Preparing the issuer authorization request.',
          comment: 'Description shown while the wallet prepares issuer authorization',
        }),
      }
    case 'resolving_presentation_request':
      return {
        title: t({
          id: 'issuance.loading.resolvingPresentationRequest.title',
          message: 'Opening issuer request',
          comment: 'Title shown while the wallet loads a presentation request during issuance',
        }),
        description: t({
          id: 'issuance.loading.resolvingPresentationRequest.description',
          message: 'Loading the issuer request that must be confirmed first.',
          comment: 'Description shown while the wallet loads a presentation request during issuance',
        }),
      }
    case 'verifying_presentation_request':
      return {
        title: t({
          id: 'issuance.loading.verifyingPresentationRequest.title',
          message: 'Checking issuer request',
          comment: 'Title shown while the wallet verifies a presentation request during issuance',
        }),
        description: t({
          id: 'issuance.loading.verifyingPresentationRequest.description',
          message: 'Verifying the issuer request before continuing.',
          comment: 'Description shown while the wallet verifies a presentation request during issuance',
        }),
      }
    case 'resolving_issuer_trust':
      return {
        title: t({
          id: 'issuance.loading.resolvingIssuerTrust.title',
          message: 'Checking issuer',
          comment: 'Title shown while the wallet resolves issuer trust during issuance',
        }),
        description: t({
          id: 'issuance.loading.resolvingIssuerTrust.description',
          message: 'Verifying who is issuing this credential.',
          comment: 'Description shown while the wallet resolves issuer trust during issuance',
        }),
      }
    case 'matching_wallet_credentials':
      return {
        title: t({
          id: 'issuance.loading.matchingWalletCredentials.title',
          message: 'Matching credentials',
          comment: 'Title shown while the wallet matches credentials for a presentation during issuance',
        }),
        description: t({
          id: 'issuance.loading.matchingWalletCredentials.description',
          message: 'Finding the credentials needed to continue the issuance.',
          comment: 'Description shown while the wallet matches credentials for a presentation during issuance',
        }),
      }
    default:
      return {
        title: t({
          id: 'receiveCredential.loadingTitle',
          message: 'Please wait',
          comment: 'Title shown while loading the credential offer',
        }),
        description: t({
          id: 'receiveCredential.loadingDescription',
          message: 'Fetching information',
          comment: 'Shown while waiting for data to be received from the issuer',
        }),
      }
  }
}
