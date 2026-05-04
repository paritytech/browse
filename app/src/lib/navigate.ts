import { hostApi } from '@novasamatech/product-sdk'

export function navigateToDomain(label: string) {
  if (hostApi?.navigateTo) {
    hostApi.navigateTo({ tag: 'v1', value: `${label}.dot` })
  } else {
    window.open(`https://${label}.dot.li`, '_blank', 'noopener')
  }
}
