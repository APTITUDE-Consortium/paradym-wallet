import {
  ClaimFormat,
  CredentialMultiInstanceUseMode,
  type DcqlCredentialsForRequest,
  type DcqlQueryResult,
  type JsonObject,
  type MdocNameSpaces,
} from '@credo-ts/core'
import { Linking } from 'react-native'
import { assertAgentType } from '../../agent'
import { getCredentialForDisplayId } from '../../display/credential'
import { ParadymWalletBiometricAuthenticationError } from '../../error'
import type { FormattedSubmissionEntrySatisfied } from '../../format/submission'
import type { ParadymWalletSdk } from '../../ParadymWalletSdk'
import type { CredentialRecord } from '../../storage/credentials'
import type { CredentialsForProofRequest } from '../func/resolveCredentialRequest'
import { getFormattedTransactionData } from '../transaction'

export type ShareCredentialsOptions = {
  paradym: ParadymWalletSdk
  resolvedRequest: CredentialsForProofRequest
  selectedCredentials: { [inputDescriptorId: string]: string }
  // FIXME: Should be a more complex structure allowing which credential to use for which entry
  acceptTransactionData?: boolean
}

export const shareCredentials = async ({
  paradym,
  resolvedRequest,
  selectedCredentials,
  acceptTransactionData,
}: ShareCredentialsOptions) => {
  assertAgentType(paradym.agent, 'openid4vc')

  const { authorizationRequest } = resolvedRequest
  if (
    !resolvedRequest.credentialsForRequest?.areRequirementsSatisfied &&
    !resolvedRequest.queryResult?.can_be_satisfied
  ) {
    throw new Error('Requirements from proof request are not satisfied')
  }

  // Map all requirements and entries to a credential record. If a credential record for an
  // input descriptor has been provided in `selectedCredentials` we will use that. Otherwise
  // it will pick the first available credential.
  const presentationExchangeCredentials = resolvedRequest.credentialsForRequest
    ? Object.fromEntries(
        await Promise.all(
          resolvedRequest.credentialsForRequest.requirements.flatMap((requirement) =>
            requirement.submissionEntry.slice(0, requirement.needsCount).map(async (entry) => {
              const credentialId = selectedCredentials[entry.inputDescriptorId]
              const credential =
                entry.verifiableCredentials.find((vc) => vc.credentialRecord.id === credentialId) ??
                entry.verifiableCredentials[0]

              // NOTE: we don't support single-use credentials for PEX
              return [entry.inputDescriptorId, [credential]]
            })
          )
        )
      )
    : undefined

  const dcqlCredentials = resolvedRequest.queryResult
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(
            (() => {
              const defaultDcqlCredentials = paradym.agent.openid4vc.holder.selectCredentialsForDcqlRequest(
                resolvedRequest.queryResult,
                {
                  // FIXME: we currently allow re-sharing if we don't have new instances anymore
                  // we should make this configurable maybe? Or dependant on credential type?
                  useMode: CredentialMultiInstanceUseMode.NewOrFirst,
                }
              )
              const normalizedSelectedCredentials = normalizeSelectedCredentialsForDcql(
                resolvedRequest.queryResult,
                resolvedRequest.formattedSubmission.entries.filter(
                  (entry): entry is FormattedSubmissionEntrySatisfied => entry.isSatisfied
                ),
                selectedCredentials
              )

              return Object.keys(selectedCredentials).length > 0
                ? // FIXME: this method should take into account w3c credentials
                  getSelectedCredentialsForRequest(
                    resolvedRequest.queryResult,
                    normalizedSelectedCredentials,
                    defaultDcqlCredentials
                  )
                : defaultDcqlCredentials
            })()
          )
        )
      )
    : undefined

  const cardForSigningId = getFormattedTransactionData(resolvedRequest)?.cardForSigningId

  try {
    const result = await paradym.agent.openid4vc.holder.acceptOpenId4VpAuthorizationRequest({
      authorizationRequestPayload: authorizationRequest,
      presentationExchange: presentationExchangeCredentials
        ? {
            credentials: presentationExchangeCredentials,
          }
        : undefined,
      dcql: dcqlCredentials
        ? {
            credentials: dcqlCredentials,
          }
        : undefined,
      transactionData:
        resolvedRequest.transactionData && acceptTransactionData && cardForSigningId
          ? [{ credentialId: cardForSigningId }]
          : undefined,
      origin: resolvedRequest.origin,
    })

    // if redirect_uri is provided, open it in the browser
    // Even if the response returned an error, we must open this uri
    if (result.redirectUri) {
      await Linking.openURL(result.redirectUri)
    }

    if (result.serverResponse && (result.serverResponse.status < 200 || result.serverResponse.status > 299)) {
      paradym.logger.error('Error while accepting authorization request', {
        authorizationRequest,
        response: result.authorizationResponse,
        responsePayload: result.authorizationResponsePayload,
      })
      throw new Error(
        `Error while accepting authorization request. ${JSON.stringify(result.serverResponse.body, null, 2)}`
      )
    }

    return result
  } catch (error) {
    // Handle biometric authentication errors
    throw ParadymWalletBiometricAuthenticationError.tryParseFromError(error) ?? error
  }
}

const matchesCredentialSelection = (credentialRecord: CredentialRecord, credentialId: string) =>
  credentialRecord.id === credentialId || getCredentialForDisplayId(credentialRecord) === credentialId

function normalizeSelectedCredentialsForDcql(
  dcqlQueryResult: DcqlQueryResult,
  satisfiedEntries: FormattedSubmissionEntrySatisfied[],
  selectedCredentials: { [credentialQueryId: string]: string }
) {
  const normalizedSelections: { [credentialQueryId: string]: string } = {}

  const getRepresentedQueryIds = (entry: FormattedSubmissionEntrySatisfied) =>
    Object.entries(dcqlQueryResult.credential_matches)
      .filter(
        ([, matchesForCredentialQuery]) =>
          matchesForCredentialQuery.success &&
          matchesForCredentialQuery.valid_credentials.some((validCredential) =>
            entry.credentials.some((entryCredential) =>
              matchesCredentialSelection(
                (validCredential as unknown as { record: CredentialRecord }).record,
                entryCredential.credential.id
              )
            )
          )
      )
      .map(([credentialQueryId]) => credentialQueryId)

  for (const [selectionKey, credentialId] of Object.entries(selectedCredentials)) {
    if (dcqlQueryResult.credential_matches[selectionKey]) {
      normalizedSelections[selectionKey] = credentialId
      continue
    }

    const matchingEntry = satisfiedEntries.find((entry) => entry.inputDescriptorId === selectionKey)
    if (!matchingEntry) continue

    const representedQueryIds = getRepresentedQueryIds(matchingEntry)
    if (credentialId.startsWith('__none__')) {
      for (const credentialQueryId of representedQueryIds) {
        normalizedSelections[credentialQueryId] = credentialId
      }
      continue
    }

    const matchingQueryIds = representedQueryIds.filter((credentialQueryId) => {
      const matchesForCredentialQuery = dcqlQueryResult.credential_matches[credentialQueryId]
      return (
        matchesForCredentialQuery.success &&
        matchesForCredentialQuery.valid_credentials.some((credential) =>
          matchesCredentialSelection((credential as unknown as { record: CredentialRecord }).record, credentialId)
        )
      )
    })

    for (const credentialQueryId of matchingQueryIds) {
      normalizedSelections[credentialQueryId] = credentialId
    }
  }

  return normalizedSelections
}

type DcqlValidCredentialWithRecord = {
  claims: {
    valid_claim_sets: Array<{
      output: unknown
    }>
  }
  record: CredentialRecord
}

type SelectedDcqlCredentialForRequest = DcqlCredentialsForRequest[string][number]

function createSelectedDcqlCredentialForRequest(
  validCredentialMatch: DcqlValidCredentialWithRecord
): SelectedDcqlCredentialForRequest {
  if (validCredentialMatch.record.type === 'MdocRecord') {
    return {
      claimFormat: ClaimFormat.MsoMdoc,
      credentialRecord: validCredentialMatch.record,
      disclosedPayload: validCredentialMatch.claims.valid_claim_sets[0].output as MdocNameSpaces,
      // FIXME: we currently allow re-sharing if we don't have new instances anymore
      // we should make this configurable maybe? Or dependant on credential type?
      useMode: CredentialMultiInstanceUseMode.NewOrFirst,
    } as const
  }

  if (validCredentialMatch.record.type === 'SdJwtVcRecord') {
    return {
      claimFormat: ClaimFormat.SdJwtDc,
      credentialRecord: validCredentialMatch.record,
      disclosedPayload: validCredentialMatch.claims.valid_claim_sets[0].output as JsonObject,
      // FIXME: we currently allow re-sharing if we don't have new instances anymore
      // we should make this configurable maybe? Or dependant on credential type?
      useMode: CredentialMultiInstanceUseMode.NewOrFirst,
    } as const
  }

  if (validCredentialMatch.record.type === 'W3cCredentialRecord') {
    return {
      claimFormat: validCredentialMatch.record.firstCredential.claimFormat,
      credentialRecord: validCredentialMatch.record,
      disclosedPayload: validCredentialMatch.claims.valid_claim_sets[0].output as JsonObject,
      // FIXME: we currently allow re-sharing if we don't have new instances anymore
      // we should make this configurable maybe? Or dependant on credential type?
      useMode: CredentialMultiInstanceUseMode.NewOrFirst,
    } as const
  }

  if (validCredentialMatch.record.type === 'W3cV2CredentialRecord') {
    return {
      claimFormat: validCredentialMatch.record.firstCredential.claimFormat,
      credentialRecord: validCredentialMatch.record,
      disclosedPayload: validCredentialMatch.claims.valid_claim_sets[0].output as JsonObject,
      // FIXME: we currently allow re-sharing if we don't have new instances anymore
      // we should make this configurable maybe? Or dependant on credential type?
      useMode: CredentialMultiInstanceUseMode.NewOrFirst,
    } as const
  }

  throw new Error('Unsupported credential record type for DCQL')
}

function getSelectedCredentialForQuery(
  dcqlQueryResult: DcqlQueryResult,
  credentialQueryId: string,
  credentialSelection: string
): [SelectedDcqlCredentialForRequest] {
  const matchesForCredentialQuery = dcqlQueryResult.credential_matches[credentialQueryId]
  if (!matchesForCredentialQuery?.success) {
    throw new Error(`Invalid dcql query result for credentialQueryId ${credentialQueryId}`)
  }

  const validCredentialMatch = matchesForCredentialQuery.valid_credentials.find((credential) =>
    matchesCredentialSelection((credential as unknown as DcqlValidCredentialWithRecord).record, credentialSelection)
  )

  if (!validCredentialMatch) {
    throw new Error(
      `Could not find credential ${credentialSelection} in valid credential matches for credentialQueryId ${credentialQueryId}`
    )
  }

  return [createSelectedDcqlCredentialForRequest(validCredentialMatch as unknown as DcqlValidCredentialWithRecord)]
}

/**
 * Selects the credentials to use based on the output from `getCredentialsForRequest`
 * Use this method if you don't want to manually select the credentials yourself.
 */
function getSelectedCredentialsForRequest(
  dcqlQueryResult: DcqlQueryResult,
  selectedCredentials: { [credentialQueryId: string]: string },
  defaultSelections: DcqlCredentialsForRequest
): DcqlCredentialsForRequest {
  if (!dcqlQueryResult.can_be_satisfied) {
    throw new Error('Cannot select the credentials for the dcql query presentation if the request cannot be satisfied')
  }

  const credentials: DcqlCredentialsForRequest = { ...defaultSelections }
  const credentialQueryIdsInSets = new Set<string>()

  const applySelectionForQuery = (credentialQueryId: string) => {
    const credentialSelection = selectedCredentials[credentialQueryId]
    if (credentialSelection?.startsWith('__none__')) {
      delete credentials[credentialQueryId]
      return
    }

    if (!credentialSelection) {
      const fallbackSelection = defaultSelections[credentialQueryId]
      if (!fallbackSelection?.length) {
        throw new Error(`Could not find default credential selection for credentialQueryId ${credentialQueryId}`)
      }

      credentials[credentialQueryId] = fallbackSelection
      return
    }

    credentials[credentialQueryId] = getSelectedCredentialForQuery(
      dcqlQueryResult,
      credentialQueryId,
      credentialSelection
    )
  }

  if (dcqlQueryResult.credential_sets) {
    for (const credentialSet of dcqlQueryResult.credential_sets) {
      const availableOptions = credentialSet.matching_options ?? credentialSet.options
      const queryIdsInSet = Array.from(new Set(credentialSet.options.flat()))

      for (const credentialQueryId of queryIdsInSet) {
        credentialQueryIdsInSets.add(credentialQueryId)
        delete credentials[credentialQueryId]
      }

      const selectedQueryIdsInSet = queryIdsInSet.filter((credentialQueryId) => selectedCredentials[credentialQueryId])
      const hasOptOut = selectedQueryIdsInSet.some((credentialQueryId) =>
        selectedCredentials[credentialQueryId]?.startsWith('__none__')
      )

      if (hasOptOut) {
        if (credentialSet.required === false) {
          continue
        }

        throw new Error('Cannot omit a required DCQL credential set')
      }

      let selectedOption =
        selectedQueryIdsInSet.length > 0
          ? availableOptions.find((option) =>
              selectedQueryIdsInSet.every((credentialQueryId) => option.includes(credentialQueryId))
            )
          : undefined

      if (!selectedOption) {
        selectedOption = availableOptions.find((option) =>
          option.every((credentialQueryId) => defaultSelections[credentialQueryId]?.length)
        )
      }

      if (!selectedOption) {
        if (credentialSet.required === false) {
          continue
        }

        throw new Error('Could not determine selected option for required DCQL credential set')
      }

      for (const credentialQueryId of selectedOption) {
        applySelectionForQuery(credentialQueryId)
      }
    }
  }

  for (const [credentialQueryId, matchesForCredentialQuery] of Object.entries(dcqlQueryResult.credential_matches)) {
    if (credentialQueryIdsInSets.has(credentialQueryId) || !matchesForCredentialQuery.success) {
      continue
    }

    applySelectionForQuery(credentialQueryId)
  }

  return credentials
}
