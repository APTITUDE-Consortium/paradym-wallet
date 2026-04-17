import { useLingui } from '@lingui/react/macro'
import { Heading, YStack } from '@package/ui'
import type { FormattedSubmission, FormattedSubmissionEntrySatisfied } from '@paradym/wallet-sdk'

import { CredentialSelectionCard } from './CredentialSelectionCard'

export type SelectedCredentialsMap = Record<string, string>

type CredentialSelectionSectionProps = {
  submission: FormattedSubmission
  selectedCredentials: SelectedCredentialsMap
  onSelect: (entryId: string, credentialId: string) => void
}

export function CredentialSelectionSection({
  submission,
  selectedCredentials,
  onSelect,
}: CredentialSelectionSectionProps) {
  const { t } = useLingui()

  const satisfiedEntries = submission.entries.filter(
    (entry): entry is FormattedSubmissionEntrySatisfied => entry.isSatisfied
  )
  const selectableEntries = satisfiedEntries.filter((entry) => entry.isSelectable === true && entry.isOptional !== true)

  if (selectableEntries.length === 0) return null

  return (
    <YStack gap="$4">
      <YStack gap="$2">
        <Heading heading="sub2">
          {t({
            id: 'presentation.selectCredentialTitle',
            message: 'Choose which credential to use',
            comment: 'Heading for the credential selection section',
          })}
        </Heading>
      </YStack>

      <YStack gap="$4">
        {selectableEntries.map((entry) => (
          <CredentialSelectionCard
            key={entry.inputDescriptorId}
            entry={entry}
            selectedCredentialId={selectedCredentials[entry.inputDescriptorId] ?? entry.credentials[0].credential.id}
            onSelect={(credentialId) => onSelect(entry.inputDescriptorId, credentialId)}
          />
        ))}
      </YStack>
    </YStack>
  )
}
