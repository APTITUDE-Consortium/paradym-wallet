import { getAptitudeSelection } from '@animo-id/expo-digital-credentials-api-aptitude-consortium'
import { type DigitalCredentialsRequest, sendResponse } from '@animo-id/expo-digital-credentials-api'
import type { CredentialsForProofRequest } from '../openid4vc/func/resolveCredentialRequest'
import { shareCredentials } from '../openid4vc/func/shareCredentials'
import type { ParadymWalletSdk } from '../ParadymWalletSdk'

export type DcApiSendResponseOptions = {
  paradym: ParadymWalletSdk
  resolvedRequest: CredentialsForProofRequest
  dcRequest: DigitalCredentialsRequest
}

export async function dcApiSendResponse({ paradym, resolvedRequest, dcRequest }: DcApiSendResponseOptions) {
  const selectionCreds =
    getAptitudeSelection(dcRequest)?.creds ??
    (dcRequest.selectedEntry?.credentialId ? [{ entryId: dcRequest.selectedEntry.credentialId }] : [])
  const hasOnlyEmptySelections =
    selectionCreds.length > 0 && selectionCreds.every((credentialSelection) => credentialSelection.entryId.startsWith('__none__'))
  const satisfiedEntries = resolvedRequest.formattedSubmission.entries.filter(
    (entry): entry is typeof entry & { isSatisfied: true } => entry.isSatisfied
  )

  if (satisfiedEntries.length === 0 && !hasOnlyEmptySelections) {
    paradym.logger.debug('Expected one entry for DC API response', {
      resolvedRequest,
      dcRequest,
    })
    throw new Error('Expected one entry for DC API response')
  }

  const fallbackEntry = satisfiedEntries[0]

  const selectedCredentials: Record<string, string> = {}

  if (selectionCreds.length) {
    for (const credentialSelection of selectionCreds) {
      const queryIdFromMetadata = credentialSelection.metadata?.dcql_id
      if (queryIdFromMetadata && credentialSelection.entryId.startsWith('__none__')) {
        selectedCredentials[queryIdFromMetadata] = credentialSelection.entryId
        continue
      }

      let matchingEntry = resolvedRequest.formattedSubmission.entries.find(
        (entry) => entry.isSatisfied && entry.inputDescriptorId === queryIdFromMetadata
      )

      if (!matchingEntry) {
        matchingEntry = resolvedRequest.formattedSubmission.entries.find(
          (entry) =>
            entry.isSatisfied &&
            entry.credentials.some((credential) => credential.credential.id === credentialSelection.entryId)
        )
      }

      if (!matchingEntry || !matchingEntry.isSatisfied) continue

      if (credentialSelection.entryId.startsWith('__none__')) {
        selectedCredentials[matchingEntry.inputDescriptorId] = credentialSelection.entryId
        continue
      }

      const matchingCredential = matchingEntry.credentials.find(
        (credential) =>
          credential.credential.id === credentialSelection.entryId ||
          credential.credential.record.id === credentialSelection.entryId
      )

      if (matchingCredential) {
        selectedCredentials[matchingEntry.inputDescriptorId] = matchingCredential.credential.record.id
      }
    }
  } else if (dcRequest.selectedEntry?.credentialId && fallbackEntry) {
    const matchingCredential = fallbackEntry.credentials.find(
      (credential) =>
        credential.credential.id === dcRequest.selectedEntry?.credentialId ||
        credential.credential.record.id === dcRequest.selectedEntry?.credentialId
    )
    selectedCredentials[fallbackEntry.inputDescriptorId] =
      matchingCredential?.credential.record.id ?? dcRequest.selectedEntry.credentialId
  }

  const result = await shareCredentials({
    paradym,
    resolvedRequest,
    selectedCredentials,
  })

  paradym.logger.debug('Sending response for Digital Credentials API', {
    result,
  })

  sendResponse({
    response: JSON.stringify(result.authorizationResponse),
  })
}
