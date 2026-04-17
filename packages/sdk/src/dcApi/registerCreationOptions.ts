import {
  encodeIssuanceCreationOptions,
  registerCreationOptions,
} from '@animo-id/expo-digital-credentials-api-cmwallet-issuance'
import { LogLevel, type Logger } from '@credo-ts/core'
import * as ExpoAsset from 'expo-asset'
import { File } from 'expo-file-system'
import { Platform } from 'react-native'

const fallbackLogger: Logger = {
  logLevel: LogLevel.info,
  test: (message, data) => console.debug(message, data),
  trace: (message, data) => console.debug(message, data),
  debug: (message, data) => console.debug(message, data),
  info: (message, data) => console.info(message, data),
  warn: (message, data) => console.warn(message, data),
  error: (message, data) => console.error(message, data),
  fatal: (message, data) => console.error(message, data),
}

type RegisterCreationOptionsForDcApiOptions = {
  title: string
  subtitle: string
  iconAsset: number | string
  logger?: Logger
}

async function readAssetAsBase64(logger: Logger, asset: ExpoAsset.Asset) {
  if (!asset.localUri) {
    await asset.downloadAsync()
  }

  if (!asset.localUri) return undefined

  try {
    const base64 = await new File(asset.localUri).base64()
    if (!base64) return undefined

    return `data:image/png;base64,${base64}` as const
  } catch (error) {
    logger.error('Error reading creation-options asset as base64.', { error })
    return undefined
  }
}

export async function registerCreationOptionsForDcApi({
  title,
  subtitle,
  iconAsset,
  logger = fallbackLogger,
}: RegisterCreationOptionsForDcApiOptions) {
  if (Platform.OS === 'ios') return

  try {
    const asset = ExpoAsset.Asset.fromModule(iconAsset)
    const iconDataUrl = await readAssetAsBase64(logger, asset)

    const creationOptions = encodeIssuanceCreationOptions({
      display: {
        title,
        subtitle,
        iconDataUrl,
      },
    })

    await registerCreationOptions({
      creationOptions,
    })
  } catch (error) {
    logger.error('Error registering creation options for DigitalCredentialsAPI', {
      error,
    })
  }
}
