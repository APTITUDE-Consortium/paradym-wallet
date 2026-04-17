import {
  getAptitudeSelection,
  type AptitudeSelectionMetadata,
} from '@animo-id/expo-digital-credentials-api-aptitude-consortium'
import type { DigitalCredentialsRequest, JsonObject } from '@animo-id/expo-digital-credentials-api'
import { resolveCredentialRequest } from '../openid4vc/func/resolveCredentialRequest'
import type { ParadymWalletSdk } from '../ParadymWalletSdk'
import { getHostNameFromUrl } from '../utils/url'

export type DcApiResolveRequestOptions = {
  paradym: ParadymWalletSdk
  request: DigitalCredentialsRequest
}

const getRequestIndex = (request: DigitalCredentialsRequest) => {
  return getAptitudeSelection(request)?.requestIdx ?? request.selectedEntry?.providerIndex ?? 0
}

const getRequestOrigin = (request: DigitalCredentialsRequest) => {
  if (typeof request.origin === 'string') return request.origin

  const sourceBundle = request.sourceBundle
  const bundleOrigin = sourceBundle?.['androidx.credentials.provider.extra.CREDENTIAL_REQUEST_ORIGIN']
  return typeof bundleOrigin === 'string' ? bundleOrigin : undefined
}

const parseJsonString = (value: string) => {
  try {
    return JSON.parse(value) as JsonObject
  } catch {
    return undefined
  }
}

const getRequestPayload = (request: DigitalCredentialsRequest) => {
  if (request.request) return request.request

  const direct = request.sourceBundle?.['androidx.credentials.BUNDLE_KEY_REQUEST_JSON']
  if (typeof direct === 'string') {
    return parseJsonString(direct)
  }

  const retrievalKey = Object.keys(request.sourceBundle ?? {}).find((key) =>
    key.startsWith('androidx.credentials.provider.extra.CREDENTIAL_OPTION_CREDENTIAL_RETRIEVAL_DATA_')
  )
  if (!retrievalKey) return undefined

  const retrievalData = request.sourceBundle?.[retrievalKey]
  if (!retrievalData || typeof retrievalData !== 'object' || Array.isArray(retrievalData)) return undefined

  const rawRequest = retrievalData['androidx.credentials.BUNDLE_KEY_REQUEST_JSON']
  return typeof rawRequest === 'string' ? parseJsonString(rawRequest) : undefined
}

const getProviderRequest = (request: DigitalCredentialsRequest) => {
  const requestPayload = getRequestPayload(request)
  if (!requestPayload) return undefined

  const requestIndex = getRequestIndex(request)
  if ('requests' in requestPayload && Array.isArray(requestPayload.requests)) {
    const entry = requestPayload.requests[requestIndex] as { data?: unknown } | undefined
    return entry?.data
  }

  if ('providers' in requestPayload && Array.isArray(requestPayload.providers)) {
    const entry = requestPayload.providers[requestIndex] as { request?: unknown } | undefined
    return entry?.request
  }

  return undefined
}

const stripUnsupportedDcqlFormats = (authorizationRequestPayload: Record<string, unknown>) => {
  const supportedFormats = new Set(['mso_mdoc', 'dc+sd-jwt', 'vc+sd-jwt', 'ldp_vc', 'jwt_vc_json'])
  const dcqlQuery = authorizationRequestPayload.dcql_query as
    | {
        credentials?: Array<Record<string, unknown>>
        credential_sets?: Array<{ options?: unknown[]; matching_options?: unknown[] }>
      }
    | undefined
  if (!dcqlQuery) return

  const credentials = dcqlQuery.credentials
  if (!Array.isArray(credentials)) return

  const unsupportedIds = new Set(
    credentials
      .filter(
        (credential): credential is { id?: string; format?: string } =>
          !!credential && typeof credential === 'object' && !Array.isArray(credential)
      )
      .filter((credential) => credential.format && !supportedFormats.has(credential.format))
      .map((credential) => credential.id)
      .filter((id): id is string => typeof id === 'string')
  )

  if (unsupportedIds.size === 0) return

  dcqlQuery.credentials = credentials.filter((credential) => {
    if (!credential || typeof credential !== 'object' || Array.isArray(credential)) return false
    return !('format' in credential) || typeof credential.format !== 'string' || supportedFormats.has(credential.format)
  })

  const credentialSets = 'credential_sets' in dcqlQuery ? dcqlQuery.credential_sets : undefined
  if (!Array.isArray(credentialSets)) return

  for (const credentialSet of credentialSets) {
    if (!credentialSet || typeof credentialSet !== 'object' || Array.isArray(credentialSet)) continue
    if (!Array.isArray(credentialSet.options)) continue

    credentialSet.options = credentialSet.options.filter(
      (option): option is string[] =>
        Array.isArray(option) && option.every((id) => typeof id === 'string') && !option.some((id) => unsupportedIds.has(id))
    )

    if (Array.isArray(credentialSet.matching_options)) {
      credentialSet.matching_options = credentialSet.matching_options.filter(
        (option): option is string[] =>
          Array.isArray(option) && option.every((id) => typeof id === 'string') && !option.some((id) => unsupportedIds.has(id))
      )
    }
  }

  dcqlQuery.credential_sets = credentialSets.filter(
    (credentialSet) =>
      !!credentialSet &&
      typeof credentialSet === 'object' &&
      !Array.isArray(credentialSet) &&
      Array.isArray(credentialSet.options) &&
      credentialSet.options.length > 0
  )
}

type SelectedCredential = {
  displayId: string
  metadata?: AptitudeSelectionMetadata
}

const getSelectedCredentials = (request: DigitalCredentialsRequest): SelectedCredential[] => {
  const selectionCreds = getAptitudeSelection(request)?.creds
  if (selectionCreds?.length) {
    return selectionCreds.map((credential) => ({
      displayId: credential.entryId,
      metadata: credential.metadata,
    }))
  }

  return request.selectedEntry?.credentialId
    ? [
        {
          displayId: request.selectedEntry.credentialId,
        },
      ]
    : []
}

export async function dcApiResolveRequest({ paradym, request }: DcApiResolveRequestOptions) {
  const providerRequest = getProviderRequest(request)
  if (!providerRequest) {
    throw new Error('Missing provider request for Digital Credentials API request')
  }

  const parsedAuthorizationRequestPayload =
    typeof providerRequest === 'string' ? parseJsonString(providerRequest) : providerRequest
  if (
    !parsedAuthorizationRequestPayload ||
    typeof parsedAuthorizationRequestPayload !== 'object' ||
    Array.isArray(parsedAuthorizationRequestPayload)
  ) {
    throw new Error('Invalid Digital Credentials API request payload')
  }
  const authorizationRequestPayload = parsedAuthorizationRequestPayload as Record<string, unknown>

  stripUnsupportedDcqlFormats(authorizationRequestPayload)

  const origin = getRequestOrigin(request)
  const result = await resolveCredentialRequest({
    paradym,
    requestPayload: authorizationRequestPayload,
    origin,
  })

  const selectedCredentials = getSelectedCredentials(request)
  const hasOnlyEmptySelections =
    selectedCredentials.length > 0 && selectedCredentials.every((credential) => credential.displayId.startsWith('__none__'))

  if (selectedCredentials.length === 0) {
    return {
      ...result,
      verifier: {
        ...result.verifier,
        hostName: origin ? getHostNameFromUrl(origin) : undefined,
      },
    }
  }

  const selectedEntryIds = new Set(selectedCredentials.map((credential) => credential.displayId))
  const selectedByQueryId = new Map<string, SelectedCredential>()

  for (const selectedCredential of selectedCredentials) {
    let queryId = selectedCredential.metadata?.dcql_id
    if (!queryId) {
      const entry = result.formattedSubmission.entries.find(
        (candidate) =>
          candidate.isSatisfied &&
          candidate.credentials.some(
            (credential) =>
              credential.credential.id === selectedCredential.displayId ||
              credential.credential.record.id === selectedCredential.displayId
          )
      )
      if (entry) queryId = entry.inputDescriptorId
    }

    if (queryId) {
      selectedByQueryId.set(queryId, selectedCredential)
    }
  }

  const filteredEntries = result.formattedSubmission.entries
    .map((entry) => {
      if (!entry.isSatisfied) return entry

      const selectedForQuery = selectedByQueryId.get(entry.inputDescriptorId)
      if (selectedForQuery?.displayId.startsWith('__none__')) {
        return undefined
      }

      const credentials = entry.credentials.filter((credential) => {
        if (selectedForQuery) {
          return (
            credential.credential.id === selectedForQuery.displayId ||
            credential.credential.record.id === selectedForQuery.displayId
          )
        }

        return selectedEntryIds.has(credential.credential.id) || selectedEntryIds.has(credential.credential.record.id)
      })

      if (credentials.length === 0) return undefined

      return {
        ...entry,
        credentials: credentials as [typeof credentials[number], ...Array<typeof credentials[number]>],
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)

  if (filteredEntries.length === 0) {
    if (hasOnlyEmptySelections) {
      return {
        ...result,
        formattedSubmission: {
          ...result.formattedSubmission,
          entries: [],
        },
        verifier: {
          ...result.verifier,
          hostName: origin ? getHostNameFromUrl(origin) : undefined,
        },
      }
    }

    throw new Error('Could not find selected credential(s) in formatted submission')
  }

  return {
    ...result,
    formattedSubmission: {
      ...result.formattedSubmission,
      entries: filteredEntries,
    },
    verifier: {
      ...result.verifier,
      hostName: origin ? getHostNameFromUrl(origin) : undefined,
    },
  }
}
