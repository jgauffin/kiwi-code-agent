export type OrderLine = { sku: string; price: number; quantity: number }

export type RefundDecision = { amount: number; manualReview: boolean }

export type Order = {
  id: string
  status: 'open' | 'shipped' | 'cancelled'
  reason?: string
  lines: OrderLine[]
}
