import {lookupArchive} from '@subsquid/archive-registry'
import * as ss58 from '@subsquid/ss58'
import {BatchContext, BatchProcessorItem, SubstrateBatchProcessor, SubstrateBlock} from '@subsquid/substrate-processor'
import {EventItem} from '@subsquid/substrate-processor/lib/interfaces/dataSelection'
import {Store, TypeormDatabase} from '@subsquid/typeorm-store'
import {Transfer} from './model/generated'
import {BalancesTransferEvent} from './types/events'

const processor = new SubstrateBatchProcessor()
    .setDataSource({
        archive: lookupArchive('kusama', {release: 'FireSquid'}),
    })
    .addEvent('Balances.Transfer', {
        data: {
            event: {
                args: true,
                extrinsic: {
                    hash: true,
                },
                call: {},
            },
        },
    } as const)

type Item = BatchProcessorItem<typeof processor>
type Ctx = BatchContext<Store, Item>

processor.run(new TypeormDatabase(), async (ctx) => {
    let transfers: Transfer[] = []

    for (let block of ctx.blocks) {
        for (let item of block.items) {
            if (item.name == 'Balances.Transfer') {
                transfers.push(new Transfer(handleTransfer(ctx, block.header, item)))
            }
        }
    }

    await ctx.store.insert(transfers)
})

interface TransferEventData {
    id: string
    blockNumber: number
    timestamp: Date
    extrinsicHash?: string
    call?: string
    from: string
    to: string
    amount: bigint
}

function handleTransfer(
    ctx: Ctx,
    block: SubstrateBlock,
    item: EventItem<'Balances.Transfer', {event: {args: true; extrinsic: {hash: true}; call: {}}}>
): TransferEventData {
    let event = normalizeTransferEvent(ctx, item)
    return {
        id: item.event.id,
        blockNumber: block.height,
        timestamp: new Date(block.timestamp),
        extrinsicHash: item.event.extrinsic?.hash,
        call: item.event.call?.name,
        from: encodeId(event.from),
        to: encodeId(event.to),
        amount: event.amount,
    }
}

function normalizeTransferEvent(
    ctx: Ctx,
    item: EventItem<'Balances.Transfer', {event: {args: true}}>
): {from: Uint8Array; to: Uint8Array; amount: bigint} {
    let e = new BalancesTransferEvent(ctx, item.event)
    if (e.isV1020) {
        let [from, to, amount] = e.asV1020
        return {from, to, amount}
    } else if (e.isV1050) {
        let [from, to, amount] = e.asV1050
        return {from, to, amount}
    } else if (e.isV9130) {
        return e.asV9130
    } else {
        throw new UknownVersionError()
    }
}

function encodeId(id: Uint8Array): string {
    return ss58.codec('kusama').encode(id)
}

class UknownVersionError extends Error {
    constructor() {
        super('Uknown verson')
    }
}
