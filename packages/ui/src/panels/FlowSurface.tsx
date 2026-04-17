import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import { Dimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FlexPage, ScrollView, type ScrollViewRefType, Stack, XStack, YStack } from '../base'
import { Image } from '../content'
import { HeroIcons } from '../content/Icon'

type LogoData = {
  altText?: string
  url?: string
}

export type FlowSurfaceProps = PropsWithChildren<{
  surface: 'fullscreen' | 'sheet'
  sheetVariant?: 'floating' | 'docked'
  logo?: LogoData
  header?: ReactNode
  footer?: ReactNode
  scrollRef?: React.RefObject<ScrollViewRefType | null>
  scrollViewProps?: Omit<ComponentProps<typeof ScrollView>, 'children'>
}>

const SHEET_TOP_MARGIN = 24
const SHEET_LOGO_SIZE = 72

export function FlowSurface({
  children,
  footer,
  header,
  logo,
  scrollRef,
  scrollViewProps,
  sheetVariant = 'floating',
  surface,
}: FlowSurfaceProps) {
  const { bottom, top } = useSafeAreaInsets()
  const windowHeight = Dimensions.get('window').height
  const { contentContainerStyle, ...restScrollViewProps } = scrollViewProps ?? {}
  const resolvedContentContainerStyle =
    !contentContainerStyle || contentContainerStyle === 'unset'
      ? { flexGrow: 1 }
      : { flexGrow: 1, ...contentContainerStyle }

  if (surface === 'fullscreen') {
    return (
      <FlexPage safeArea="t" p="$4" gap="$0" bg="$background">
        <YStack fg={1} gap="$6">
          {header}
          <YStack fg={1} minHeight={0} gap="$6">
            {children}
          </YStack>
        </YStack>
        {footer}
      </FlexPage>
    )
  }

  const logoSlotHeight = logo ? SHEET_LOGO_SIZE / 2 : 0
  const isDockedSheet = sheetVariant === 'docked'
  const maxHeight =
    windowHeight - Math.max(top, SHEET_TOP_MARGIN) - (isDockedSheet ? 0 : Math.max(bottom, 16))

  return (
    <Stack flex-1 bg="transparent" justifyContent="flex-end">
      <YStack
        width="100%"
        mx={isDockedSheet ? 0 : 16}
        mb={isDockedSheet ? 0 : Math.max(bottom, 16)}
        maxHeight={maxHeight}
        pos="relative"
        overflow="visible"
      >
        {logo ? (
          <XStack pos="absolute" top={-SHEET_LOGO_SIZE / 2} left={0} right={0} jc="center" zi={1}>
            <YStack
              width={SHEET_LOGO_SIZE}
              height={SHEET_LOGO_SIZE}
              br={SHEET_LOGO_SIZE / 2}
              bw={1}
              borderColor="$grey-100"
              bg="$white"
              shadow
              overflow="hidden"
            >
              {logo.url ? (
                <Image src={logo.url} alt={logo.altText} contentFit="contain" width="100%" height="100%" />
              ) : (
                <Stack fg={1} ai="center" jc="center" bg="$grey-50">
                  <HeroIcons.BuildingOffice color="$grey-700" size={28} />
                </Stack>
              )}
            </YStack>
          </XStack>
        ) : null}

        <YStack
          bg="$white"
          borderTopLeftRadius="$8"
          borderTopRightRadius="$8"
          borderBottomLeftRadius={isDockedSheet ? 0 : '$8'}
          borderBottomRightRadius={isDockedSheet ? 0 : '$8'}
          overflow="hidden"
          pt={logoSlotHeight + 24}
          shadow
        >
          {header ? (
            <YStack px="$4" pb="$4">
              {header}
            </YStack>
          ) : null}
          <ScrollView
            ref={scrollRef}
            flexGrow={0}
            flexShrink={1}
            minHeight={0}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={resolvedContentContainerStyle}
            {...restScrollViewProps}
          >
            <YStack fg={1} minHeight={0} px="$4" pb="$4">
              {children}
            </YStack>
          </ScrollView>
          {footer ? (
            <YStack
              btw="$0.5"
              borderColor="$grey-200"
              pt="$4"
              pb={isDockedSheet ? Math.max(bottom, 16) : 0}
              mt="$4"
              px="$4"
            >
              {footer}
            </YStack>
          ) : isDockedSheet ? (
            <YStack height={Math.max(bottom, 16)} />
          ) : null}
        </YStack>
      </YStack>
    </Stack>
  )
}
