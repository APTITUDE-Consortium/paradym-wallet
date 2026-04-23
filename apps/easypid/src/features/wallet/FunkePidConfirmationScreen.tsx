import { useLingui } from '@lingui/react/macro'
import type { PinDotsInputRef } from '@package/app'
import { commonMessages } from '@package/translations'
import { FlexPage, HeroIcons, YStack } from '@package/ui'
import { forwardRef } from 'react'
import { Circle } from 'tamagui'
import { WalletPinPromptHeader, WalletPinPromptInput } from '../../components/WalletPinPrompt'

export interface FunkePidConfirmationScreenProps {
  onSubmitPin: (pin: string) => void
  isLoading: boolean
}

export const FunkePidConfirmationScreen = forwardRef<PinDotsInputRef, FunkePidConfirmationScreenProps>(
  ({ onSubmitPin, isLoading }: FunkePidConfirmationScreenProps, ref) => {
    const { t } = useLingui()

    return (
      <FlexPage flex-1 alignItems="center">
        <YStack flex-1 alignItems="center" justifyContent="flex-end" gap="$4">
          <WalletPinPromptHeader
            title={t(commonMessages.enterPin)}
            centerHeader
            headerIcon={
              <Circle size="$4" backgroundColor="$grey-100">
                <HeroIcons.LockClosed strokeWidth={2} color="$grey-700" />
              </Circle>
            }
            titleHeading="h2"
            titleFontWeight="$semiBold"
          />
        </YStack>
        <WalletPinPromptInput isLoading={isLoading} inputRef={ref} onPinComplete={onSubmitPin} />
      </FlexPage>
    )
  }
)
