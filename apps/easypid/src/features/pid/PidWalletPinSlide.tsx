import { type PinDotsInputRef, useWizard } from '@package/app'
import { useDeviceMedia, YStack } from '@package/ui'
import { useRef, useState } from 'react'
import { WalletPinPromptHeader, WalletPinPromptInput } from '../../components/WalletPinPrompt'

interface PidWalletPinSlideProps {
  title: string
  subtitle?: string
  onEnterPin: (pin: string) => Promise<void>
}

export function PidWalletPinSlide({ title, subtitle, onEnterPin }: PidWalletPinSlideProps) {
  const { onNext } = useWizard()
  const [isLoading, setIsLoading] = useState(false)
  const ref = useRef<PinDotsInputRef>(null)
  const { additionalPadding, noBottomSafeArea } = useDeviceMedia()
  const onSubmitPin = async (pin: string) => {
    if (isLoading) return
    setIsLoading(true)

    await onEnterPin(pin)
      .then(() => {
        onNext()
      })
      .catch(() => {
        ref.current?.shake()
        ref.current?.clear()
      })

    setIsLoading(false)
  }

  return (
    <YStack fg={1} jc="space-between" mb={noBottomSafeArea ? -additionalPadding : undefined}>
      <YStack gap="$6">
        <YStack gap="$3">
          <WalletPinPromptHeader title={title} subtitle={subtitle} titleHeading="h1" />
        </YStack>
      </YStack>
      <YStack flexGrow={1} mt="$10">
        <WalletPinPromptInput isLoading={isLoading} inputRef={ref} onPinComplete={onSubmitPin} />
      </YStack>
    </YStack>
  )
}
