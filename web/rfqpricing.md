# Pricing

The Pricing Endpoint provides real-time streaming data for the pricing of tokens on Bebop PMM RFQ. This data is delivered over a WebSocket connection, allowing for efficient and low-latency access.

{% hint style="info" %}
Access to pricing endpoint must be authenticated. Please reach out to us for access.
{% endhint %}

## Endpoints

<table><thead><tr><th width="214">Chain</th><th>Websocket URL</th></tr></thead><tbody><tr><td>Arbitrum</td><td>wss://api.bebop.xyz/pmm/arbitrum/v3/pricing?format=protobuf</td></tr><tr><td>Avalanche</td><td>wss://api.bebop.xyz/pmm/avalanche/v3/pricing?format=protobuf</td></tr><tr><td>Base</td><td>wss://api.bebop.xyz/pmm/base/v3/pricing?format=protobuf</td></tr><tr><td>BNB Chain</td><td>wss://api.bebop.xyz/pmm/bsc/v3/pricing?format=protobuf</td></tr><tr><td>Ethereum</td><td>wss://api.bebop.xyz/pmm/ethereum/v3/pricing?format=protobuf</td></tr><tr><td>HyperEVM</td><td>wss://api.bebop.xyz/pmm/hyperevm/v3/pricing?format=protobuf</td></tr><tr><td>Optimism</td><td>wss://api.bebop.xyz/pmm/optimism/v3/pricing?format=protobuf</td></tr><tr><td>Polygon</td><td>wss://api.bebop.xyz/pmm/polygon/v3/pricing?format=protobuf</td></tr><tr><td>Solana</td><td>wss://api.bebop.xyz/pmm/solana/v3/pricing?format=protobuf</td></tr></tbody></table>

{% hint style="warning" %}
Only 1 connection is allowed per chain.
{% endhint %}

## Formats

You have the option to consume pricing under 2 formats. `format=json or format=protobuf`

{% hint style="danger" %}
JSON format pricing is streamed infrequently (every 3s) and frequency may be reduced in the future. It is HIGHLY recommended to use protobufs instead.
{% endhint %}

Protobufs are a wire format that allows highly efficient exchange of large data. It should be the preferred way of consuming pricing because you will:

* Receive updates faster - < 1s
* Need to download less data reducing your infrastructure costs

### Implementing protobufs

```protobuf
syntax = "proto3";

package bebop;

message PriceUpdate {
  optional bytes base = 1;
  optional bytes quote = 2;
  optional uint64 last_update_ts = 3;
  repeated float bids = 4 [packed=true];
  repeated float asks = 5 [packed=true];
}

message BebopPricingUpdate {
  repeated PriceUpdate pairs = 1;
}
```

Use the following proto file to generate your preferred language classes.

Some tips:

* `base` and `quote` address fields are encoded in raw bytes and need to be parsed to string if needed.
* Bids and asks are packed into an array of floats. You can deconstruct it into `price, size` pairs as such:&#x20;

  ```python
  def to_pairs(array: list[float]) -> list[tuple[float, float]]:
      return [(array[i], array[i + 1]) for i in range(0, len(array), 2)]
  ```

## Authentication

Authentication is required to connect to the pricing websocket. It is required in the form of a `name` and `Authorization` header. Supply these when connecting to the websocket:

<pre><code>wscat -c wss://api.bebop.xyz/pmm/ethereum/v3/pricing \
<strong>-H name:myname \
</strong>-H Authorization:xxxx-xxxxxxxxx-xxxxxx-xxxxxx
</code></pre>

## Stream

Upon successful connection, you will automatically start receiving updates for all available pairs.&#x20;

* The streamed books for a pair include an aggregate of all market makers available on the Bebop platform.&#x20;
* Levels indicate the quantity and price available. They are ordered by price and mutually exclusive.
* Prices derived from levels are indicative, executable prices are set at the time of quote.&#x20;

{% hint style="success" %}
Use the [quote endpoint ](https://docs.bebop.xyz/bebop/bebop-api-pmm-rfq/rfq-api-endpoints/trade/get-quote)to receive a fixed quote

To retrieve a quote that can be executed independently of Bebop see [Self Execute Order](https://docs.bebop.xyz/bebop/bebop-api-pmm-rfq/rfq-api-endpoints/trade/self-execute-order)
{% endhint %}

All supported tokens are quoted against USDC (or alternatively another asset) and keyed by contract address:  `<contract_address>/<usdc_contract_address>`

```json
{
  "0x111111111117dC0aa78b770fA6A738034120C302/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": {
    "last_update_ts": 1701713197.6878347,
    "bids": [
      [0.3662120542374637, 272.7291214881094],
      [0.36617475352201256, 1363.645607440547]
    ],
    "asks": [
      [0.3671971903961104, 272.7291214881094],
      [0.36723449111185014, 1363.645607440547]
    ]
  },
  "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": {
    "last_update_ts": 1701713197.6878488,
    "bids": [
      [98.13757660883493, 1.017729577636548],
      [98.12758075594644, 5.088647888182741]
    ],
    "asks": []
  }
}
```

{% hint style="warning" %}
Makers may stream an empty array for `bids` or `asks` when they lack inventory, have excess inventory, or due to compliance reasons.
{% endhint %}

### Response Format

<table><thead><tr><th width="200">Property</th><th width="282">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>last_updated_ts</code></td><td><code>float</code></td><td>The time in unix when this pair was last updated.</td></tr><tr><td><code>bids</code></td><td><code>Array&#x3C;[price, quantity]></code></td><td>A list of mutually exclusive bid levels </td></tr><tr><td><code>asks</code></td><td><code>Array&#x3C;[price, quantity]></code></td><td>A list of mutually exclusive ask levels </td></tr></tbody></table>

## Interpreting Price Levels

The price level should be considered individually and indicate the amounts of tokens that can be bought or sold at the respective price.&#x20;

{% hint style="info" %}
For example, for token ZZZ you see a bid of 5 for a size of 1,000 USDC, and a bid of 4 for a size of 10,000 USDC. This means that you can sell a total of 1,000\*5 + 10,0000\*4 = 45,000 worth of USDC.&#x20;
{% endhint %}

## Calculating Quotes

Since all pairs are quoted in USDC (or another single asset), you need to calculate  an indicative quote through the levels streamed.

In other words, to convert from `AAA -> BBB:`

1. Sell `AAA` for `USDC`, filling through `[AAA/USDC].bids`
2. Sell `USDC` for `BBB`, filling through `[BBB/USDC].asks`

{% hint style="warning" %}
Note: quotes calculated using levels are estimates. When retrieving a quote using the API, different results may be provided depending on time of quote, size, among other factors. &#x20;
{% endhint %}