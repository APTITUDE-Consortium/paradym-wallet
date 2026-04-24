import { verifyOpenid4VpAuthorizationRequest } from '@animo-id/eudi-wallet-functionality'
import type { DifPresentationExchangeDefinitionV2 } from '@credo-ts/core'
import type { OpenId4VpResolvedAuthorizationRequest } from '@credo-ts/openid4vc'
import { assertAgentType } from '../../agent'
import { ParadymWalletNoRequestToResolveError } from '../../error'
import { formatDcqlCredentialsForRequest } from '../../format/dcqlRequest'
import { formatDifPexCredentialsForRequest } from '../../format/presentationExchangeRequest'
import type { FormattedSubmission } from '../../format/submission'
import type { ParadymWalletSdk } from '../../ParadymWalletSdk'
import {
  type AuthorizationRequestVerificationResult,
  detectTrustMechanism,
  getTrustedEntities,
  type TrustMechanism,
} from '../../trust/trustMechanism'

export type ResolveCredentialRequestOptions = {
  paradym: ParadymWalletSdk
  requestPayload?: Record<string, unknown>
  uri?: string
  allowUntrusted?: boolean
  origin?: string
}

const getResponseUriOrigin = (resolvedAuthorizationRequest: OpenId4VpResolvedAuthorizationRequest) => {
  const responseUri = resolvedAuthorizationRequest.authorizationRequestPayload.response_uri
  if (typeof responseUri !== 'string') {
    return undefined
  }

  try {
    return new URL(responseUri).origin
  } catch {
    return undefined
  }
}

const getFallbackTrustResolution = ({
  resolvedAuthorizationRequest,
}: {
  resolvedAuthorizationRequest: OpenId4VpResolvedAuthorizationRequest
}): {
  trustMechanism: TrustMechanism
  trustedEntities: []
  relyingParty: { logoUri?: string; uri?: string; organizationName?: string; entityId: string }
} => {
  const uri = getResponseUriOrigin(resolvedAuthorizationRequest)
  const entityId = resolvedAuthorizationRequest.authorizationRequestPayload.client_id ?? uri

  if (!entityId) {
    throw new Error('Missing required client_id in authorization request')
  }

  let trustMechanism: TrustMechanism = 'x509'
  try {
    trustMechanism = detectTrustMechanism({ resolvedAuthorizationRequest })
  } catch {
    // Default to x509 so existing UI can still render a generic trust state.
  }

  return {
    trustMechanism,
    trustedEntities: [],
    relyingParty: {
      entityId,
      uri,
      organizationName: resolvedAuthorizationRequest.authorizationRequestPayload.client_metadata?.client_name,
      logoUri: resolvedAuthorizationRequest.authorizationRequestPayload.client_metadata?.logo_uri,
    },
  }
}

export const resolveCredentialRequest = async ({
  paradym,
  uri,
  requestPayload,
  origin,
  allowUntrusted,
}: ResolveCredentialRequestOptions) => {
  assertAgentType(paradym.agent, 'openid4vc')
  try {
    const requestToResolve = uri ?? requestPayload

    if (!requestToResolve) {
      throw new ParadymWalletNoRequestToResolveError(
        'Either supply a uri or requestPayload to get the credentials for a proof request'
      )
    }

    const resolved = await paradym.agent.openid4vc.holder.resolveOpenId4VpAuthorizationRequest(requestToResolve, {
      origin,
      // NOTE: add back when enabling federation support
      // trustedFederationEntityIds: paradym.trustMechanisms.find((tm) => tm.trustMechanism === 'openid_federation')
      // ?.trustedEntityIds,
    })

    let authorizationRequestVerificationResult: AuthorizationRequestVerificationResult | undefined
    try {
      authorizationRequestVerificationResult = await verifyOpenid4VpAuthorizationRequest(paradym.agent.context, {
        resolvedAuthorizationRequest: resolved,
        allowUntrustedSigned: allowUntrusted,
      })
    } catch (error) {
      if (!allowUntrusted) {
        throw error
      }

      paradym.logger.warn('Skipping relying party verification because untrusted parties are allowed in this flow.', {
        error,
      })
    }

    let trustResolution: Awaited<ReturnType<typeof getTrustedEntities>>
    try {
      trustResolution = await getTrustedEntities({
        paradym,
        resolvedAuthorizationRequest: resolved,
        authorizationRequestVerificationResult,
      })
    } catch (error) {
      if (!allowUntrusted) {
        throw error
      }

      paradym.logger.warn('Falling back to an untrusted relying party because trust resolution failed.', {
        error,
      })
      trustResolution = getFallbackTrustResolution({
        resolvedAuthorizationRequest: resolved,
      })
    }

    const { trustMechanism, trustedEntities, relyingParty } = trustResolution

    let formattedSubmission: FormattedSubmission
    if (resolved.presentationExchange) {
      formattedSubmission = formatDifPexCredentialsForRequest(
        resolved.presentationExchange.credentialsForRequest,
        resolved.presentationExchange.definition as DifPresentationExchangeDefinitionV2
      )
    } else if (resolved.dcql) {
      formattedSubmission = formatDcqlCredentialsForRequest(resolved.dcql.queryResult)
    } else {
      throw new Error('No presentation exchange or dcql found in authorization request.')
    }

    return {
      ...resolved.presentationExchange,
      ...resolved.dcql,
      origin,
      authorizationRequest: resolved.authorizationRequestPayload,
      formattedSubmission,
      transactionData: resolved.transactionData,
      trustMechanism,
      verifier: {
        hostName: relyingParty.uri,
        entityId: relyingParty.entityId,
        logo: relyingParty.logoUri
          ? {
              url: relyingParty.logoUri,
            }
          : undefined,
        name: relyingParty.organizationName,
        trustedEntities,
      },
    }
  } catch (error) {
    paradym.logger.error('Error getting credentials for request', {
      error,
    })

    throw error
  }
}

export type CredentialsForProofRequest = Awaited<ReturnType<typeof resolveCredentialRequest>>
