# Gas Estimation for Batch Operations

## Problem

Batch operations with 20+ items can fail with "out of gas" errors despite Stellar's automatic gas estimation. The `prepareTransaction()` simulation underestimates gas requirements for complex multi-operation transactions by approximately 30%.

## Solution

The SDK now automatically applies a gas multiplier for batch operations:

- **Automatic**: 1.5x multiplier for transactions with 20+ operations
- **Manual**: Configurable `gasMultiplier` option for fine-tuned control
- **Transparent**: Fee estimates show both original and adjusted values

## Usage

### Automatic Gas Adjustment

For batch operations, the SDK automatically applies a 1.5x multiplier:

```typescript
import { SorobanTransactionBuilder } from '@soroban-identity/sdk';

const builder = new SorobanTransactionBuilder(account, config);

// Add 25 operations (triggers automatic 1.5x multiplier)
for (let i = 0; i < 25; i++) {
  builder.addContractCall(contractId, 'method', ...args);
}

const feeEstimate = await builder.estimateFee(operation);
console.log('Original resource fee:', feeEstimate.originalResourceFee);
console.log('Adjusted resource fee:', feeEstimate.resourceFee);
console.log('Gas multiplier:', feeEstimate.gasMultiplier); // 1.5
```

### Manual Gas Multiplier

Override the automatic multiplier for specific needs:

```typescript
const builder = new SorobanTransactionBuilder(account, config);

builder
  .addContractCall(contractId, 'batchMethod', ...args)
  .setGasMultiplier(1.8)  // 80% buffer for extra-large batches
  .build();

const feeEstimate = await builder.estimateFee(operation);
// Gas multiplier: 1.8
```

### Using with executeTransaction

Apply gas multiplier during transaction execution:

```typescript
import { executeTransaction } from '@soroban-identity/sdk';

await executeTransaction(
  server,
  tx,
  signer,
  {
    gasMultiplier: 1.5,  // 50% gas buffer
    pollRetries: 15,
    pollInterval: 2000
  }
);
```

## Gas Multiplier Behavior

### Automatic Thresholds

| Operation Count | Multiplier | Reason |
|----------------|------------|---------|
| 1-19 | 1.0x | Standard estimation sufficient |
| 20+ | 1.5x | Batch operations need buffer |

### When to Use Manual Multiplier

**Use higher multipliers (1.6-2.0) when:**
- Operations involve heavy computation
- Contract has complex cross-contract calls
- Historical data shows consistent gas failures
- Better safe than failed (cost vs reliability trade-off)

**Use default (1.0-1.5) when:**
- Single or few operations
- Simple contract calls
- Testing or development environments

## Fee Estimate Breakdown

The `FeeEstimate` object now includes:

```typescript
interface FeeEstimate {
  baseFee: number;                  // Network base fee
  resourceFee: number;               // Adjusted resource fee (with multiplier)
  totalFee: number;                  // baseFee + resourceFee
  gasMultiplier?: number;            // Applied multiplier (e.g., 1.5)
  originalResourceFee?: number;      // Pre-adjustment fee
}
```

**Example output:**
```json
{
  "baseFee": 100,
  "resourceFee": 15000,              // 10000 * 1.5
  "totalFee": 15100,
  "gasMultiplier": 1.5,
  "originalResourceFee": 10000
}
```

## Cost Impact

### Estimated Costs

For a batch operation with 20 DIDs:

| Scenario | Resource Fee | Gas Multiplier | Final Fee | Outcome |
|----------|-------------|----------------|-----------|---------|
| Without multiplier | 10,000 stroops | 1.0x | 10,100 | ❌ Out of gas |
| With multiplier | 15,000 stroops | 1.5x | 15,100 | ✅ Success |

**XLM Cost:**
- Without multiplier: 0.00101 XLM (fails)
- With multiplier: 0.00151 XLM (succeeds)
- **Extra cost: 0.0005 XLM (~$0.00006 USD)**

The 50% buffer adds minimal cost but prevents transaction failures.

## Migration Guide

### Before (Manual Workaround)

```typescript
// OLD: Manually multiply estimated fee
const prepared = await server.prepareTransaction(tx);
const currentFee = parseInt(prepared.fee, 10);
const adjustedFee = Math.ceil(currentFee * 1.5);
prepared._fee = adjustedFee.toString();  // Internal mutation
```

### After (Built-in Support)

```typescript
// NEW: Automatic for 20+ operations
const builder = new SorobanTransactionBuilder(account, config);
for (let i = 0; i < 25; i++) {
  builder.addContractCall(contractId, 'method', ...args);
}
const tx = builder.build();
// Gas multiplier applied automatically

// OR: Explicit control
await executeTransaction(server, tx, signer, { gasMultiplier: 1.5 });
```

## Best Practices

1. **Let automatic multiplier handle common cases**  
   The SDK applies 1.5x for 20+ operations — no manual adjustment needed

2. **Monitor actual gas usage**  
   Log `feeEstimate.originalResourceFee` vs actual consumption to tune multipliers

3. **Use higher multipliers for production critical ops**  
   Better to overpay slightly than fail mid-batch

4. **Test with multiplier disabled (1.0) in development**  
   Understand real gas costs before adding buffer

5. **Document custom multipliers**  
   If using values other than 1.5x, comment why:
   ```typescript
   builder.setGasMultiplier(2.0);  // Heavy computation, validated via profiling
   ```

## Troubleshooting

### Still seeing "out of gas" with multiplier

**Cause:** Extremely large batches or complex contracts may need higher multipliers

**Solution:**
```typescript
builder.setGasMultiplier(2.0);  // Increase to 2x
```

### Fees too high

**Cause:** Multiplier applied when not needed

**Solution:**
```typescript
builder.setGasMultiplier(1.0);  // Disable for simple operations
```

### How to verify multiplier is applied

Check the fee estimate:
```typescript
const estimate = await builder.estimateFee(operation);
console.assert(estimate.gasMultiplier === 1.5);
console.assert(estimate.resourceFee > estimate.originalResourceFee);
```

## References

- [Stellar Gas Mechanics](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering)
- [Soroban Resource Model](https://soroban.stellar.org/docs/fundamentals-and-concepts/resource-limits-fees)
- [Issue #742](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/742)

## Related Issues

- #477: Multi-operation fee estimation fixed
- #742: Batch operation gas underestimation (this fix)
