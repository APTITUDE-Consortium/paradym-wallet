import { ClaimFormat, type DcqlQueryResult, type MdocNameSpaces, type NonEmptyArray } from '@credo-ts/core'
import { getDisclosedAttributePathArrays } from '../display/common'
import { getCredentialForDisplay } from '../display/credential'
import { getAttributesAndMetadataForMdocPayload } from '../display/mdoc'
import { getAttributesAndMetadataForSdJwtPayload } from '../display/sdJwt'
import { formatAttributesWithRecordMetadata } from './attributes'
import type {
  FormattedSubmission,
  FormattedSubmissionEntry,
  FormattedSubmissionEntrySatisfiedCredential,
} from './submission'

function extractCredentialPlaceholderFromQueryCredential(credential: DcqlQueryResult['credentials'][number]) {
  if (credential.format === 'mso_mdoc') {
    return {
      claimFormat: ClaimFormat.MsoMdoc,
      credentialName: credential.meta?.doctype_value ?? 'Unknown',
      requestedAttributePaths: credential.claims?.map((c) => ('path' in c ? [c.path[1]] : [c.claim_name])),
    }
  }

  if (
    (credential.format === 'vc+sd-jwt' && credential.meta && 'vct_values' in credential.meta) ||
    credential.format === 'dc+sd-jwt'
  ) {
    return {
      claimFormat: ClaimFormat.SdJwtDc,
      credentialName:
        credential.meta && 'vct_values' in credential.meta
          ? credential.meta?.vct_values?.[0].replace('https://', '')
          : undefined,
      requestedAttributePaths: credential.claims?.map((c) => c.path),
    }
  }

  return {
    claimFormat: ClaimFormat.JwtVc,
    requestedAttributePaths: credential.claims?.map((c) => c.path),
  }
}

export function formatDcqlCredentialsForRequest(dcqlQueryResult: DcqlQueryResult): FormattedSubmission {
  const credentialSets: NonNullable<DcqlQueryResult['credential_sets']> = dcqlQueryResult.credential_sets ?? [
    // If no credential sets are defined we create a default one with just all the credential options
    {
      required: true,
      options: [dcqlQueryResult.credentials.map((c) => c.id)],
      matching_options: dcqlQueryResult.can_be_satisfied ? [dcqlQueryResult.credentials.map((c) => c.id)] : undefined,
    },
  ]

  const entries: FormattedSubmissionEntry[] = []
  credentialSets.forEach((credentialSet, credentialSetIndex) => {
    const isOptional = credentialSet.required === false
    const areSingleCredentialOptions = credentialSet.options.every((option) => option.length === 1)
    const optionGroups = areSingleCredentialOptions
      ? credentialSet.matching_options?.length
        ? credentialSet.matching_options
        : dcqlQueryResult.can_be_satisfied
          ? credentialSet.options
          : [credentialSet.options[0]]
      : [credentialSet.matching_options?.[0] ?? credentialSet.options[0]]

    const selectedCredentialIds = areSingleCredentialOptions
      ? Array.from(new Set(optionGroups.flat()))
      : optionGroups[0]
    const firstCredentialId = selectedCredentialIds[0]
    const firstQueryCredential = dcqlQueryResult.credentials.find((c) => c.id === firstCredentialId)
    if (!firstQueryCredential) {
      throw new Error(`Credential '${firstCredentialId}' not found in dcql query`)
    }

    const optionCredentials: FormattedSubmissionEntrySatisfiedCredential[] = []
    const seenCredentialIds = new Set<string>()
    let isOptionSatisfied = true
    for (const credentialId of selectedCredentialIds) {
      const match = dcqlQueryResult.credential_matches[credentialId]
      const queryCredential = dcqlQueryResult.credentials.find((c) => c.id === credentialId)
      if (!queryCredential) {
        throw new Error(`Credential '${credentialId}' not found in dcql query`)
      }

      if (!match || !match.success) {
        isOptionSatisfied = false
        break
      }

      for (const validMatch of match.valid_credentials) {
        const credentialForDisplay = getCredentialForDisplay(validMatch.record)
        let disclosed: FormattedSubmissionEntrySatisfiedCredential['disclosed']

        if (validMatch.record.type === 'SdJwtVcRecord') {
          // Credo already applied selective disclosure on payload
          const { attributes, metadata } = getAttributesAndMetadataForSdJwtPayload(
            validMatch.claims.valid_claim_sets[0].output
          )

          disclosed = {
            rawAttributes: attributes,
            attributes: formatAttributesWithRecordMetadata(attributes, validMatch.record),
            metadata,
            paths: getDisclosedAttributePathArrays(attributes, 2),
          }
        } else if (validMatch.record.type === 'MdocRecord') {
          const namespaces = validMatch.claims.valid_claim_sets[0].output as MdocNameSpaces
          const { attributes, metadata } = getAttributesAndMetadataForMdocPayload(
            namespaces,
            validMatch.record.firstCredential
          )

          disclosed = {
            metadata,
            rawAttributes: attributes,
            attributes: formatAttributesWithRecordMetadata(attributes, validMatch.record),
            paths: getDisclosedAttributePathArrays(namespaces, 2),
          }
        } else {
          // All paths disclosed for W3C
          disclosed = {
            rawAttributes: credentialForDisplay.rawAttributes,
            attributes: credentialForDisplay.attributes,
            metadata: credentialForDisplay.metadata,
            paths: getDisclosedAttributePathArrays(credentialForDisplay.rawAttributes, 2),
          }
        }

        if (seenCredentialIds.has(credentialForDisplay.id)) continue
        seenCredentialIds.add(credentialForDisplay.id)

        optionCredentials.push({
          credential: credentialForDisplay,
          disclosed,
        })
      }
    }

    if (!isOptionSatisfied || optionCredentials.length === 0) {
      const placeholderCredential = extractCredentialPlaceholderFromQueryCredential(firstQueryCredential)
      const placeholderTitle =
        typeof credentialSet.purpose === 'string' && credentialSet.purpose.trim().length > 0
          ? credentialSet.purpose
          : (placeholderCredential.credentialName ?? 'Credential')
      const placeholderDescription =
        placeholderCredential.credentialName && placeholderCredential.credentialName.trim() !== placeholderTitle.trim()
          ? placeholderCredential.credentialName
          : undefined

      entries.push({
        isSatisfied: false,
        isOptional,
        inputDescriptorId: `credential-set-${credentialSetIndex}`,
        name: placeholderTitle,
        description: placeholderDescription,
        requestedAttributePaths: placeholderCredential.requestedAttributePaths ?? [],
      })
      return
    }

    const groupTitle =
      typeof credentialSet.purpose === 'string' && credentialSet.purpose.trim().length > 0
        ? credentialSet.purpose
        : (optionCredentials[0].credential.display.name ?? firstQueryCredential.id)
    const groupDescription =
      optionCredentials[0].credential.display.name?.trim() &&
      optionCredentials[0].credential.display.name.trim() !== groupTitle.trim()
        ? optionCredentials[0].credential.display.name
        : undefined

    entries.push({
      inputDescriptorId: `credential-set-${credentialSetIndex}`,
      credentials: optionCredentials as NonEmptyArray<FormattedSubmissionEntrySatisfiedCredential>,
      isSatisfied: true,
      isOptional,
      isSelectable: areSingleCredentialOptions && optionGroups.length > 1,
      name: groupTitle,
      description: groupDescription,
    })
  })

  return {
    areAllSatisfied: entries.every((entry) => entry.isSatisfied || entry.isOptional === true),
    purpose: credentialSets.map((s) => s.purpose).find((purpose): purpose is string => typeof purpose === 'string'),
    entries,
  }
}
