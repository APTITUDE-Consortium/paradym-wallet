import 'fast-text-encoding'
import registerGetCredentialComponent, {
  registerCreateCredentialComponent,
} from '@animo-id/expo-digital-credentials-api/register'
import { registerLocales } from '@package/translations'
import type { DigitalCredentialsCreateRequest, DigitalCredentialsRequest } from '@animo-id/expo-digital-credentials-api'
import { App as ExpoRouterApp } from 'expo-router/build/qualified-entry'
import { renderRootComponent } from 'expo-router/build/renderRootComponent'
import { createElement, type FC } from 'react'
import { AppRegistry, Platform } from 'react-native'
import { DeepLinkOverlayRoot } from './src/features/native-activity/DeepLinkOverlayRoot'
import { messages as al } from './src/locales/al/messages'
import { messages as de } from './src/locales/de/messages'
import { messages as en } from './src/locales/en/messages'
import { messages as fi } from './src/locales/fi/messages'
import { messages as nl } from './src/locales/nl/messages'
import { messages as pt } from './src/locales/pt/messages'
import { messages as sw } from './src/locales/sw/messages'

const DcApiSharingScreenEntry: FC<{ request: DigitalCredentialsRequest }> = (props) => {
  const { DcApiSharingScreen } = require('./src/features/share/DcApiSharingScreen') as typeof import('./src/features/share/DcApiSharingScreen')
  return createElement(DcApiSharingScreen, props)
}

const DcApiIssuanceScreenEntry: FC<{ request: DigitalCredentialsCreateRequest }> = (props) => {
  const { DcApiIssuanceScreen } = require('./src/features/receive/DcApiIssuanceScreen') as typeof import('./src/features/receive/DcApiIssuanceScreen')
  return createElement(DcApiIssuanceScreen, props)
}

type DeepLinkOverlayLaunchProps = {
  initialUrl?: string
}

const DeepLinkOverlayApp: FC<DeepLinkOverlayLaunchProps> = ({ initialUrl }) =>
  createElement(DeepLinkOverlayRoot, { initialUrl })

// Register translations
registerLocales({
  en,
  nl,
  fi,
  sw,
  de,
  al,
  pt,
})

// Always register the custom component for Android
if (Platform.OS === 'android') {
  registerGetCredentialComponent(DcApiSharingScreenEntry)
  registerCreateCredentialComponent(DcApiIssuanceScreenEntry)
  AppRegistry.registerComponent('DeepLinkOverlayActivity', () => DeepLinkOverlayApp)
}

renderRootComponent(ExpoRouterApp)
