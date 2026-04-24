import { useMMKVBoolean } from 'react-native-mmkv'
import { mmkv } from '../storage/mmkv'

export function useDisableRelyingPartyVerification() {
  const [isDisabled = false, setIsDisabled] = useMMKVBoolean('disableRelyingPartyVerification', mmkv)

  return [isDisabled, setIsDisabled] as const
}
