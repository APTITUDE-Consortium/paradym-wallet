import { QrScannerScreen } from '@package/app'
import { credentialDataHandlerOptions } from '@easypid/config/credentialDataHandlerOptions'

export default function Screen() {
  return <QrScannerScreen credentialDataHandlerOptions={{ ...credentialDataHandlerOptions, routeMethod: 'replace' }} />
}
