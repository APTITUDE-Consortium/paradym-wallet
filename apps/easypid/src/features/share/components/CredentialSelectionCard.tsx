import { Trans, useLingui } from '@lingui/react/macro'
import { commonMessages } from '@package/translations'
import { FloatingSheet, Heading, HeroIcons, Stack, YStack } from '@package/ui'
import type { FormattedSubmissionEntrySatisfied } from '@paradym/wallet-sdk'
import { useMemo, useState } from 'react'
import { Pressable } from 'react-native'
import { Circle, Path, Svg } from 'react-native-svg'

import { CredentialCard } from './CredentialCard'

interface CredentialSelectionCardProps {
  entry: FormattedSubmissionEntrySatisfied
  selectedCredentialId: string
  onSelect: (id: string) => void
}

function ActiveCheckbox() {
  return (
    <Svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="11.75" fill="#4365DE" stroke="#D7DCE0" strokeWidth="0.5" />
      <Path d="M7 12L11 16L17 7" stroke="#F5F7F8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

function InactiveCheckbox() {
  return (
    <Svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="11.75" fill="white" stroke="#D7DCE0" strokeWidth="0.5" />
    </Svg>
  )
}

export function CredentialSelectionCard({ entry, onSelect, selectedCredentialId }: CredentialSelectionCardProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const { t } = useLingui()

  const selectedCredential = useMemo(
    () =>
      entry.credentials.find((credential) => credential.credential.id === selectedCredentialId) ?? entry.credentials[0],
    [entry.credentials, selectedCredentialId]
  )

  if (!selectedCredential) return null

  const isSelectable = entry.isSelectable === true

  return (
    <>
      <CredentialCard
        credentialDisplay={selectedCredential.credential.display}
        title={entry.name ?? selectedCredential.credential.display.name}
        subtitle={entry.description ?? selectedCredential.credential.display.description}
        isSelectable={isSelectable}
        onPress={isSelectable ? () => setIsSheetOpen(true) : undefined}
        rightElement={isSelectable ? <HeroIcons.Interaction size={24} color="$grey-600" /> : undefined}
      />

      <FloatingSheet isOpen={isSheetOpen} setIsOpen={setIsSheetOpen}>
        <YStack pb="$4" px="$4" gap="$4">
          <Stack ai="center" pt="$3" pb="$1">
            <Stack w={32} h={4} br="$2" bg="$grey-200" />
          </Stack>

          <YStack gap="$2">
            <Heading textAlign="left" fontSize={24} fontWeight="600" lineHeight={36} textTransform="none">
              <Trans id="credentialSelection.sheetTitle" comment="Title for the credential selection sheet">
                Select Credential
              </Trans>
            </Heading>
            <YStack gap="$4">
              {entry.credentials.map((credential) => (
                <CredentialCard
                  key={credential.credential.id}
                  credentialDisplay={credential.credential.display}
                  subtitle={credential.credential.display.description}
                  isSelectable
                  onPress={() => {
                    onSelect(credential.credential.id)
                    setIsSheetOpen(false)
                  }}
                  rightElement={
                    credential.credential.id === selectedCredentialId ? <ActiveCheckbox /> : <InactiveCheckbox />
                  }
                />
              ))}
            </YStack>

            <Pressable onPress={() => setIsSheetOpen(false)}>
              <YStack ai="center" py="$2">
                <Heading fontSize={16} fontWeight="600" color="#6D7581" textTransform="none">
                  {t(commonMessages.close)}
                </Heading>
              </YStack>
            </Pressable>
          </YStack>
        </YStack>
      </FloatingSheet>
    </>
  )
}
