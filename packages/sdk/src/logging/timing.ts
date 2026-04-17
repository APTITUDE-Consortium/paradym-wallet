import type { LogData, ParadymWalletSdkLogger } from './ParadymWalletSdkLogger'

const getDurationMs = (startedAt: number) => Date.now() - startedAt

export const createTimingLogger = (logger: ParadymWalletSdkLogger, scope: string) => {
  const scopeStartedAt = Date.now()

  return {
    async step<T>(name: string, run: () => Promise<T>, data?: LogData) {
      const startedAt = Date.now()
      logger.debug(`${scope}.${name}.start`, data)

      try {
        const result = await run()
        logger.info(`${scope}.${name}.done`, {
          ...data,
          durationMs: getDurationMs(startedAt),
        })
        return result
      } catch (error) {
        logger.error(`${scope}.${name}.failed`, {
          ...data,
          durationMs: getDurationMs(startedAt),
          error,
        })
        throw error
      }
    },
    finish(data?: LogData) {
      logger.info(`${scope}.done`, {
        ...data,
        durationMs: getDurationMs(scopeStartedAt),
      })
    },
  }
}
