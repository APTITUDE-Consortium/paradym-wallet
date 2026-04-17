import {
  type AptitudeConsortiumConfig,
  registerCredentials as registerAptitudeCredentials,
} from '@animo-id/expo-digital-credentials-api-aptitude-consortium'
import { DateOnly, type Logger, type MdocNameSpaces, type SdJwtVcRecord } from '@credo-ts/core'
import { ImageFormat, Skia } from '@shopify/react-native-skia'
import * as ExpoAsset from 'expo-asset'
import { File } from 'expo-file-system'
import { Image } from 'expo-image'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Platform } from 'react-native'
import { getCredentialForDisplay, getCredentialForDisplayId } from '../display/credential'
import { sanitizeString } from '../display/strings'
import type { ParadymWalletSdk } from '../ParadymWalletSdk'

type CredentialItem = NonNullable<AptitudeConsortiumConfig['credentials']>[number]
type CredentialField = NonNullable<CredentialItem['fields']>[number]
type ImageDataUrl = `data:image/${'jpg' | 'png'};base64,${string}`

type AptitudeTransactionDataTypes = NonNullable<
  NonNullable<NonNullable<AptitudeConsortiumConfig['credentials']>[number]>['transaction_data_types']
>
type AptitudeTransactionDataTypeConfig = AptitudeTransactionDataTypes[number]
type ScaClaimDisplay = {
  locale?: string
  name: string
}
type ScaClaim = {
  path: Array<string | number | null>
  display?: ScaClaimDisplay[]
}
type ScaUiLabelValue = {
  locale?: string
  value: string
}
type ScaTransactionDataType = {
  claims?: ScaClaim[]
  ui_labels?: Record<string, ScaUiLabelValue[]>
}
type ScaCredentialMetadata = {
  transaction_data_types?: Record<string, ScaTransactionDataType>
}

function mapMdocAttributes(namespaces: MdocNameSpaces) {
  return Object.fromEntries(
    Object.entries(namespaces).map(([namespace, values]) => [
      namespace,
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => {
          if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
            return [key, value]
          }

          if (value instanceof Date || value instanceof DateOnly) {
            return [key, value.toISOString()]
          }

          return [key, null]
        })
      ),
    ])
  )
}

function mapMdocAttributesToFieldConfig(namespaces: MdocNameSpaces): CredentialField[] {
  return Object.entries(namespaces).flatMap(([namespace, values]) =>
    Object.keys(values).map((key) => ({
      path: [namespace, key],
      display_name: sanitizeString(key),
    }))
  )
}

function mapSdJwtAttributesToFieldConfig(claims: object, path: string[] = []): CredentialField[] {
  return Object.entries(claims).flatMap(([claimName, value]) => {
    const nestedClaims =
      value && typeof value === 'object' && !Array.isArray(value)
        ? mapSdJwtAttributesToFieldConfig(value, [...path, claimName])
        : []

    return [
      {
        path: [...path, claimName],
        display_name: sanitizeString(claimName),
      },
      ...nestedClaims,
    ]
  })
}

async function getSdJwtTransactionDataTypes(
  logger: Logger,
  typeMetadata?: unknown
): Promise<AptitudeTransactionDataTypes | undefined> {
  const metadata = typeMetadata as ScaCredentialMetadata | undefined
  const transactionDataTypes = metadata?.transaction_data_types
  if (!transactionDataTypes || typeof transactionDataTypes !== 'object') return undefined

  const mappedEntries = Object.entries(transactionDataTypes).flatMap(([type, config]) => {
    if (!config || typeof config !== 'object') return []

    const claims = Array.isArray(config.claims)
      ? config.claims
          .filter(
            (claim): claim is ScaClaim =>
              !!claim &&
              typeof claim === 'object' &&
              Array.isArray(claim.path) &&
              claim.path.every((segment) => segment === null || typeof segment === 'string' || typeof segment === 'number')
          )
          .map((claim) => ({
            path: claim.path,
            display: Array.isArray(claim.display)
              ? claim.display
                  .filter(
                    (label): label is ScaClaimDisplay =>
                      !!label && typeof label === 'object' && typeof label.name === 'string'
                  )
                  .map((label) => ({
                    locale: label.locale ?? 'und',
                    label: label.name,
                    description: undefined,
                  }))
              : undefined,
          }))
      : undefined

    const uiLabels = config.ui_labels
      ? Object.entries(config.ui_labels).flatMap(([key, values]) => {
          if (!Array.isArray(values)) return []

          return [
            {
              key,
              values: values
                .filter(
                  (value): value is ScaUiLabelValue =>
                    !!value && typeof value === 'object' && typeof value.value === 'string'
                )
                .map((value) => ({
                  locale: value.locale ?? 'und',
                  value: value.value,
                })),
            },
          ]
        })
      : undefined

    return [
      {
        type,
        claims: claims?.length ? claims : undefined,
        ui_labels: uiLabels?.length ? uiLabels : undefined,
      } satisfies AptitudeTransactionDataTypeConfig,
    ]
  })

  if (mappedEntries.length === 0) {
    logger.debug('Skipping SD-JWT transaction data registration because no valid transaction_data_types were found')
    return undefined
  }

  return mappedEntries
}

function normalizeAptitudeIcon(iconDataUrl?: string) {
  if (!iconDataUrl) return undefined

  const commaIndex = iconDataUrl.indexOf(',')
  return commaIndex >= 0 ? iconDataUrl.slice(commaIndex + 1) : iconDataUrl
}

function getSdJwtVctValues(record: SdJwtVcRecord) {
  const vctValuesFromChain = record.typeMetadataChain
    ?.map((entry) => entry.vct)
    .filter((vct): vct is string => typeof vct === 'string' && vct.length > 0)

  const tagVct = record.getTags().vct
  const values =
    vctValuesFromChain && vctValuesFromChain.length > 0 ? vctValuesFromChain : tagVct ? [tagVct] : []

  if (values.length === 0) return undefined

  return Array.from(new Set(values))
}

async function resizeImageWithAspectRatio(logger: Logger, asset: ExpoAsset.Asset): Promise<ImageDataUrl | undefined> {
  try {
    if (!asset.localUri) {
      await asset.downloadAsync()
    }

    if (!asset.localUri) {
      return undefined
    }

    const file = new File(asset.localUri)
    const handle = file.open()
    let header = ''
    try {
      header = new TextDecoder().decode(handle.readBytes(50))
    } finally {
      handle.close()
    }

    if (header.startsWith('<?xml') || header.startsWith('<svg')) {
      const svg = Skia.SVG.MakeFromString(await file.text())
      if (!svg) return undefined

      const scale = Math.min(120 / svg.width(), 120 / svg.height())
      const surface = Skia.Surface.Make(Math.round(svg.width() * scale), Math.round(svg.height() * scale))
      if (!surface) {
        throw new Error('Unable to rasterize SVG')
      }

      surface.getCanvas().drawSvg(svg, surface.width(), surface.height())
      return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 80)}` as const
    }

    const image = await Image.loadAsync(asset.localUri)
    const targetSize = 120
    const width = image.width >= image.height ? targetSize : Math.round((image.width / image.height) * targetSize)
    const height = image.height > image.width ? targetSize : Math.round((image.height / image.width) * targetSize)

    const resizedImage = await ImageManipulator.manipulate(image).resize({ width, height }).renderAsync()
    const savedImage = await resizedImage.saveAsync({
      base64: true,
      format: SaveFormat.PNG,
      compress: 1,
    })

    if (!savedImage.base64) return undefined

    return `data:image/png;base64,${savedImage.base64}` as ImageDataUrl
  } catch (error) {
    logger.error('Error resizing image.', {
      error,
    })
    throw error
  }
}

function getImageMimeFromUri(uri?: string): 'png' | 'jpg' {
  if (!uri) return 'png'
  const lower = uri.toLowerCase().split('?')[0].split('#')[0]
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpg'
  return 'png'
}

async function readAssetAsBase64(logger: Logger, asset: ExpoAsset.Asset): Promise<ImageDataUrl | undefined> {
  if (!asset.localUri) return undefined

  try {
    const base64 = await new File(asset.localUri).base64()
    if (!base64) return undefined

    return `data:image/${getImageMimeFromUri(asset.localUri)};base64,${base64}` as ImageDataUrl
  } catch (error) {
    logger.error('Error reading asset as base64.', { error })
    return undefined
  }
}

async function loadCachedImageAsBase64DataUrl(
  logger: Logger,
  url: string | number
): Promise<ImageDataUrl | undefined> {
  let asset: ExpoAsset.Asset | undefined

  try {
    if (typeof url === 'string') {
      if (url.startsWith('data:') || url.startsWith('data://')) {
        const normalized = url.replace(/^data:\/\//, 'data:')
        if (normalized.startsWith('data:image/jpeg;base64,')) {
          return `data:image/jpg;base64,${normalized.slice('data:image/jpeg;base64,'.length)}` as ImageDataUrl
        }
        if (/^data:image\/(png|jpg);base64,/i.test(normalized)) {
          return normalized as ImageDataUrl
        }
        return undefined
      }

      if (url.startsWith('http://') || url.startsWith('https://')) {
        const cachePath = await Image.getCachePathAsync(url)
        if (!cachePath) return undefined

        asset = await ExpoAsset.Asset.fromURI(`file://${cachePath}`).downloadAsync()
        return await resizeImageWithAspectRatio(logger, asset)
      }

      if (url.startsWith('file://')) {
        asset = await ExpoAsset.Asset.fromURI(url).downloadAsync()
        return await resizeImageWithAspectRatio(logger, asset)
      }
    }

    asset = ExpoAsset.Asset.fromModule(url)
    try {
      return await resizeImageWithAspectRatio(logger, asset)
    } catch {
      return await readAssetAsBase64(logger, asset)
    }
  } catch (error) {
    logger.error('Error resizing and retrieving cached image for DC API', {
      error,
    })

    if (asset) {
      return await readAssetAsBase64(logger, asset)
    }
  }
}

export type DcApiRegisterCredentialsOptions = {
  paradym: ParadymWalletSdk
  displayTitleFallback: string
  displaySubtitle: (issuerName: string) => string
  displaySubtitleFallback: string
}

export async function dcApiRegisterCredentials({
  displayTitleFallback,
  paradym,
  displaySubtitleFallback,
  displaySubtitle,
}: DcApiRegisterCredentialsOptions) {
  if (Platform.OS === 'ios') return

  try {
    const mdocRecords = await paradym.agent.mdoc.getAll()
    const sdJwtVcRecords = await paradym.agent.sdJwtVc.getAll()

    const mdocCredentials = mdocRecords.map(async (record): Promise<CredentialItem> => {
      const mdoc = record.firstCredential
      const { display } = getCredentialForDisplay(record)

      const iconDataUrl = display.backgroundImage?.url
        ? await loadCachedImageAsBase64DataUrl(paradym.logger, display.backgroundImage.url)
        : display.issuer.logo?.url
          ? await loadCachedImageAsBase64DataUrl(paradym.logger, display.issuer.logo.url)
          : undefined

      return {
        id: getCredentialForDisplayId(record),
        format: 'mso_mdoc',
        title: display.name ?? displayTitleFallback,
        subtitle: display.issuer.name ? displaySubtitle(display.issuer.name) : displaySubtitleFallback,
        fields: mapMdocAttributesToFieldConfig(mdoc.issuerSignedNamespaces),
        icon: normalizeAptitudeIcon(iconDataUrl),
        doctype: mdoc.docType,
        claims: mapMdocAttributes(mdoc.issuerSignedNamespaces),
      } as const
    })

    const sdJwtCredentials = sdJwtVcRecords.map(async (record): Promise<CredentialItem> => {
      const sdJwtVc = record.firstCredential
      const { display } = getCredentialForDisplay(record)

      const iconDataUrl = display.backgroundImage?.url
        ? await loadCachedImageAsBase64DataUrl(paradym.logger, display.backgroundImage.url)
        : display.issuer.logo?.url
          ? await loadCachedImageAsBase64DataUrl(paradym.logger, display.issuer.logo.url)
          : undefined

      const transactionDataTypes = await getSdJwtTransactionDataTypes(paradym.logger, record.typeMetadata)

      return {
        id: getCredentialForDisplayId(record),
        format: 'dc+sd-jwt',
        title: display.name ?? displayTitleFallback,
        subtitle: display.issuer.name ? displaySubtitle(display.issuer.name) : displaySubtitleFallback,
        fields: mapSdJwtAttributesToFieldConfig(sdJwtVc.prettyClaims),
        icon: normalizeAptitudeIcon(iconDataUrl),
        vcts: getSdJwtVctValues(record),
        transaction_data_types: transactionDataTypes,
        claims: sdJwtVc.prettyClaims as CredentialItem['claims'],
      } as const
    })

    const credentials = await Promise.all([...sdJwtCredentials, ...mdocCredentials])
    paradym.logger.trace('Registering credentials for Digital Credentials API')

    const aptitudeConfig: AptitudeConsortiumConfig = {
      openid4vp: {
        enabled: true,
        allow_dcql: true,
        allow_transaction_data: true,
        allow_signed_requests: true,
        allow_response_mode_jwt: true,
      },
      log_level: __DEV__ ? 'debug' : undefined,
      dcql: {
        credential_set_option_mode: 'all_satisfiable',
        optional_credential_sets_mode: 'prefer_present',
      },
      credentials,
    }

    await registerAptitudeCredentials({
      aptitudeConsortiumConfig: aptitudeConfig,
    })
  } catch (error) {
    paradym.logger.error('Error registering credentials for DigitalCredentialsAPI', {
      error,
    })
  }
}
