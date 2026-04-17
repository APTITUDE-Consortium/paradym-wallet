import { verifyOpenid4VpAuthorizationRequest } from '@animo-id/eudi-wallet-functionality'
import type { DifPresentationExchangeDefinitionV2 } from '@credo-ts/core'
import { assertAgentType } from '../../agent'
import { ParadymWalletNoRequestToResolveError } from '../../error'
import { formatDcqlCredentialsForRequest } from '../../format/dcqlRequest'
import { formatDifPexCredentialsForRequest } from '../../format/presentationExchangeRequest'
import type { FormattedSubmission } from '../../format/submission'
import type { ParadymWalletSdk } from '../../ParadymWalletSdk'
import { getTrustedEntities } from '../../trust/trustMechanism'
import { createTimingLogger } from '../../logging'

export type ResolveCredentialRequestStage =
  | 'resolving_request'
  | 'verifying_request'
  | 'resolving_trust'
  | 'matching_credentials'

export type ResolveCredentialRequestOptions = {
  paradym: ParadymWalletSdk
  requestPayload?: Record<string, unknown>
  uri?: string
  allowUntrusted?: boolean
  origin?: string
  onProgress?: (stage: ResolveCredentialRequestStage) => void
}

export const resolveCredentialRequest = async ({
  paradym,
  uri,
  requestPayload,
  origin,
  allowUntrusted,
  onProgress,
}: ResolveCredentialRequestOptions) => {
  assertAgentType(paradym.agent, 'openid4vc')
  try {
    const timing = createTimingLogger(paradym.logger, 'openid4vp.resolveRequest')
    const requestToResolve = uri ?? requestPayload

    if (!requestToResolve) {
      throw new ParadymWalletNoRequestToResolveError(
        'Either supply a uri or requestPayload to get the credentials for a proof request'
      )
    }

    onProgress?.('resolving_request')
    const resolved = await timing.step('resolveAuthorizationRequest', async () =>
      paradym.agent.openid4vc!.holder.resolveOpenId4VpAuthorizationRequest(requestToResolve, {
        origin,
        // NOTE: add back when enabling federation support
        // trustedFederationEntityIds: paradym.trustMechanisms.find((tm) => tm.trustMechanism === 'openid_federation')
        // ?.trustedEntityIds,
      })
    )

    onProgress?.('verifying_request')
    const authorizationRequestVerificationResult = await timing.step('verifyAuthorizationRequest', async () =>
      verifyOpenid4VpAuthorizationRequest(paradym.agent.context, {
        resolvedAuthorizationRequest: resolved,
        allowUntrustedSigned: allowUntrusted,
      })
    )

    onProgress?.('resolving_trust')
    const { trustMechanism, trustedEntities, relyingParty } = await timing.step('resolveTrust', async () =>
      getTrustedEntities({
        paradym,
        resolvedAuthorizationRequest: resolved,
        authorizationRequestVerificationResult,
      })
    )

    let formattedSubmission: FormattedSubmission
    onProgress?.('matching_credentials')
    formattedSubmission = await timing.step('matchCredentials', async () => {
      if (resolved.presentationExchange) {
        return formatDifPexCredentialsForRequest(
          resolved.presentationExchange.credentialsForRequest,
          resolved.presentationExchange.definition as DifPresentationExchangeDefinitionV2
        )
      }

      if (resolved.dcql) {
        return formatDcqlCredentialsForRequest(resolved.dcql.queryResult)
      }

      throw new Error('No presentation exchange or dcql found in authorization request.')
    })

    timing.finish({
      hasDcql: Boolean(resolved.dcql),
      hasPresentationExchange: Boolean(resolved.presentationExchange),
    })

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
