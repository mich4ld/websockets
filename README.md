# Websocket server 
#### Simplified websocket protocol implementation for server in TypeScript.

It is not intended for use in production. Use community approved projects instead.

<img 
  width="620px" 
  src="https://user-images.githubusercontent.com/43048524/168474871-c24d0ead-dac3-4e31-aa78-3d9b9e90f8b6.jpg"
  alt="hide-pain-harold-computer" 
/>

## Painful process
Websocket protocol was harder to implement than I initially thought. I learned a lot about networking and dealing with bitwise operations. Although my implementation is not perfect, it can handle larger files (like images and videos).

### Two main challenges
Handling large WS frames is hard because we have to deal with frame fragmentation over TCP data stream. Second major challenge is parsing WS frame.

### Good resources to learn how Websocket works
1. Wikipedia: https://en.wikipedia.org/wiki/WebSocket
2. WebSockets Crash Course - Handshake, Use-cases, Pros & Cons and more: https://youtu.be/2Nt-ZrNP22A
3. WebSocket Tutorial - How WebSockets Work: https://youtu.be/pNxK8fPKstc
4. WebSocket RFC: https://www.rfc-editor.org/rfc/rfc6455


## How it works?

### First stage - WebSocket handshake over HTTP protocol
Client sends special HTTP request with special headers:
```yml
GET /chat HTTP/1.1
Host: server.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==
Sec-WebSocket-Protocol: chat, superchat
Sec-WebSocket-Version: 13
Origin: http://example.com
```

Server response:
```yml
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: HSmrc0sMlYUkAGmm5OPpG2HaGWk=
Sec-WebSocket-Protocol: chat
```

As you can see there are a few WS specific headers like: `Sec-WebSocket-Key`, `Sec-WebSocket-Protocol`, `Sec-WebSocket-Version`. 
What is `Sec-WebSocket-Key`? It's an unique key generated by client. Server needs it for generating `Sec-WebSocket-Accept` header.

According to official RFC and Wikipedia, `Sec-WebSocket-Accept` value is base64 encoded SHA-1 hash of `Sec-WebSocket-Key` combined with fixed UUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B1`.

```ts
function createWsAcceptKey(wsKey: string): string {
    const uuid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // constant UUID definied in WS docs
    const dataToHash = wsKey + uuid

    return createHash('sha1')
        .update(Buffer.from(dataToHash))
        .digest('base64');
}
```

#### Finalizing WebSocket handshake
Just send required headers like `Upgrade`, `Connection` and `Sec-WebSocket-Accept`. Remember about HTTP status code `101` (Switching Protocols) and body with extra blank line at the end.
```ts
function finalizeHandshake(res: ServerResponse, wsAcceptKey: string) {
    res.statusCode = 101;
    
    // set headers:
    res.setHeader('Upgrade', 'websocket');
    res.setHeader('Connection', 'Upgrade');
    res.setHeader('Sec-WebSocket-Accept', wsAcceptKey);
    
    res.write('\r\n');
    res.end();
}
```

### Second stage - parsing WebSocket frame
<img src="https://user-images.githubusercontent.com/43048524/168477955-780ff531-b2e3-4746-bc9a-549204d6c8c9.png" />

Important reference: https://www.rfc-editor.org/rfc/rfc6455#section-5.2


1 byte = 8 bits

#### Important concepts for parsing frame
1. What is endianess? (https://www.freecodecamp.org/news/what-is-endianness-big-endian-vs-little-endian/)
2. Bitwise operators (https://en.wikipedia.org/wiki/Bitwise_operation)

#### Reuse TCP connection socket
```ts
const server = new Server((req, res) => {
  ...
  finalizeHandshake(res, wsAcceptKey);
   
  // We have to reuse socket from HTTP request. Now we can operate on TCP level
  req.socket.on('data', (buff) => {})
});
 ```

#### Parsing first byte of frame
![image](https://user-images.githubusercontent.com/43048524/168479784-566fb245-4e01-4088-a043-0c35fe40c7d8.png)

Read first byte from buffer:
```ts
req.socket.on('data', (buff) => {
  let byteOffset = 0;
  const firstByte = buff.readUint8(byteOffset);
})
```

#### How to read bits (1 byte = 8 bits)?
Our `firstByte` variable is interpreted by Node.js as decimal number - How to get all information from byte? We have to use bitwise operators for operations on bits.

##### How to read n-bit? Example:
```ts
...
const firstByte = buff.readUint8(byteOffset); // 129 as decimal = 10000001 as binary

const firstBit = (firstByte >> 7) & 0x1; // 1
const secondBit = (firstByte >> 6) & 0x1; // 0
const thirdBit = (firstByte >> 5) & 0x1; // 0
```

##### How to read last n-bits? Example:
```ts
...
const firstByte = buff.readUint8(byteOffset); // 129 as decimal = 10000001 as binary
const lastFourBits = firstByte & 15;  // 15 as decimal = 00001111 as binary

console.log(lastFourBits) // 1 as decimal = 0001 as binary
```

#### Let's actually parse first byte
```ts
let byteOffset = 0;
const firstByte = buff.readUint8(byteOffset);

const fin = Boolean((firstByte >> 7) & 0x1);

const rsv1 = (firstByte >> 6) & 0x1;
const rsv2 = (firstByte >> 5) & 0x1;
const rsv3 = (firstByte >> 4) & 0x1;

const opcode = firstByte & 15;
```

`fin` - our first bit in frame. Indicates that this is the final fragment in a message. `0` - false, `1` - true;

`rsv1`, `rsv2`, `rsv3` - we don't really care about those reserved fields. They are useful for extending WebSocket protocol.

According to RFC: "MUST be 0 unless an extension is negotiated that defines meanings for non-zero values.";

`opcode` - four bits. Defines the type of payload data.

According to RFC: 
- `0x0`  denotes a continuation frame
- `0x1` denotes a text frame
- `0x2` denotes a binary frame
- `0x8` denotes a connection close
- `0x9` denotes a ping
- `0xA` denotes a pong

#### Parsing second byte of frame
![image](https://user-images.githubusercontent.com/43048524/168483384-c0449989-50ea-4def-bfcd-c4f345d49b1c.png)

```ts
...
byteOffset++;   // 1
const secondByte = buff.readUInt8(byteOffset);

const mask = Boolean((secondByte >> 7) & 0x1);
let payloadLen = secondByte & 127;
```

`mask` - (1 bit). Defines whether the payload is masked. If set to 1, a masking key is present in masking-key, and this is used to unmask the payload.

More about `MASK`: https://security.stackexchange.com/questions/113297/whats-the-purpose-of-the-mask-in-a-websocket

`payloadLen` - (7 last bits). the length of payload data. 

According to RFC: "if 0-125, that is the payload length.  If 126, the following 2 bytes interpreted as a 16-bit unsigned integer are the payload length.  If 127, the following 8 bytes interpreted as a 64-bit unsigned integer (the most significant bit MUST be 0) are the payload length."

#### payloadLen === 126 case
![image](https://user-images.githubusercontent.com/43048524/168484792-f6cf7738-8d20-413d-bbf3-d7d4eea59fd8.png)

If payloadLen is equal `126`, the following 2 bytes interpreted as a 16-bit integer are the payload length. `2 bytes = 16 bits`. 

`readUint16BE(offset)` reads the following 16 bits in the big-endian format (most common format in networking).

```ts
...
let payloadLen = secondByte & 127;

byteOffset++;

if (payloadLen === 126) {
  payloadLen = buff.readUint16BE(byteOffset);

  byteOffset += 2; // because we read 16 bits (2 bytes).
}
```

#### payloadLen === 127 case
![image](https://user-images.githubusercontent.com/43048524/168486584-60f09fcd-6f7f-4f48-be9d-a11a174bf473.png)

If payloadLen is equal 127, the following 8 bytes interpreted as a 64-bit unsigned integer (the most significant bit MUST be 0) are the payload length.

In JavaScript it is hard to support 64-bit payload length because it's can be Bigint value (not regular JS number type), so we will support only 32-bit integers:

```ts
...
if (payloadLen === 127) {
  const first32bits = buff.readUInt32BE(byteOffset);
  const second32bits = buff.readUInt32BE(byteOffset + 4);

  if (first32bits !== 0) {
    throw new Error('Payload with 8 byte length is not supported');
  }

  payloadLen = second32bits;
  byteOffset += 8; // because we read 64 bits (8 bytes).
}
```

Btw - 64-bit is ridiculously big length (we are talking about SINGLE frame).

#### Reading Masking-key
![image](https://user-images.githubusercontent.com/43048524/168487900-b84a0342-0c04-4c14-bad0-21224e62e2aa.png)

That part of frame depends on `mask` value. Web browsers ALWAYS mask their frames, so expect `mask` to be `true`.
If `mask` is `false`, we skip `Masking-key` part.

According to RFC: "All frames sent from the client to the server are masked by a 32-bit value that is contained within the frame. This field is present if the mask bit is set to 1 and is absent if the mask bit is set to 0."

I recommend keeping `maskingKey` as four byte Buffer, instead just 32-bit decimal. It will make unmasking payload process easier (in my opinion).
```ts
...
let maskingKey = Buffer.alloc(4);
if (mask) {
  maskingKey = buff.slice(byteOffset, byteOffset + 4);
  byteOffset += 4; // because we read 4 bytes.
}
```

#### Reading Payload-Data
![image](https://user-images.githubusercontent.com/43048524/168488647-9ac72c36-23da-4e2b-be13-fdb071c261ad.png)

```ts
const rawPayload = buff.slice(byteOffset); // we basically read remaining part of buffer
const payload = mask ? unmask(rawPayload, payloadLen, maskingKey) : rawPayload;
```
Now, we have to implement `unmask` function.

#### Unmask and RFC definition
According to RFC:
"The masking does not affect the length of the "Payload data".  To
   convert masked data into unmasked data, or vice versa, the following
   algorithm is applied.  The same algorithm applies regardless of the
   direction of the translation, e.g., the same steps are applied to
   mask the data as to unmask the data.

   Octet i of the transformed data ("transformed-octet-i") is the XOR of
   octet i of the original data ("original-octet-i") with octet at index
   i modulo 4 of the masking key ("masking-key-octet-j"):

     j = i MOD 4
     transformed-octet-i = original-octet-i XOR masking-key-octet-j

   The payload length, indicated in the framing as frame-payload-length,
   does NOT include the length of the masking key.  It is the length of
   the "Payload data", e.g., the number of bytes following the masking
   key."
   
<br />

What `octet` is? Octet just like byte, is equal 8 bits (https://en.wikipedia.org/wiki/Octet_(computing))

`1 octet` = `1 byte` = `8 bits`

What `XOR` means? It's `^` Bitwise operator (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Bitwise_XOR)

What `MOD` means? Modulo operator `%` (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Remainder)


#### Unmasking implementation
1. Allocate `payloadLen` bytes of memory for unmasked payload.
2. Loop over each byte of payload.
3. Just like in RFC: declare `j` variable equal `i MOD 4` (`i % 4`).
4. Just like in RFC: `unmasked-payload[i] = masked-payload[i] XOR masking-key[j]`
5. Write unmasked byte to allocated `payload` Buffer with index equal `i`.
6. We have unmasked payload - we can already READ content.

```ts
function unmask(rawPayload: Buffer, payloadLen: number, maskingKey: Buffer) {
    const payload = Buffer.alloc(payloadLen);
    
    for (let i = 0; i < payloadLen; i++) {
        const j = i % 4;
        const decoded = rawPayload[i] ^ (maskingKey[j]);

        payload.writeUInt8(decoded, i);
    }

    return payload;
}
```

#### Frame in our TypeScript code
We want to represent frame as regular object.
```ts
interface IFrame {
  fin: boolean;
  rsv1: number;
  rsv2: number;
  rsv3: number;
  opcode: number;
  mask: boolean;
  payloadLen: number;
  payload: Buffer;
  frameLen: number;
}

...
...

const rawPayload = buff.slice(byteOffset);
const payload = mask ? unmask(rawPayload, payloadLen, maskingKey) : rawPayload;

const frame: IFrame = {
  fin,
  rsv1,
  rsv2,
  rsv3,
  opcode,
  mask,
  payloadLen,
  payload,
  frameLen: byteOffset + payload.byteLength,
}

```

### Third stage - we did it wrong

My current code:
```ts
const server = new Server((req, res) => {
    const wsKey = req.headers['sec-websocket-key'];
    const wsAcceptKey = createWsAcceptKey(wsKey!);
    finalizeHandshake(res, wsAcceptKey);
     
    // We have to reuse socket from HTTP request. Now we can operate on TCP level
    req.socket.on('data', (buff) => {
        let byteOffset = 0;
        const firstByte = buff.readUint8(byteOffset);

        const fin = Boolean((firstByte >> 7) & 0x1);

        const rsv1 = (firstByte >> 6) & 0x1;
        const rsv2 = (firstByte >> 5) & 0x1;
        const rsv3 = (firstByte >> 4) & 0x1;

        const opcode = firstByte & 15;

        byteOffset++;   // 1
        const secondByte = buff.readUInt8(byteOffset);

        const mask = Boolean((secondByte >> 7) & 0x1);
        let payloadLen = secondByte & 127;

        byteOffset++;

        if (payloadLen === 126) {
            payloadLen = buff.readUint16BE(byteOffset);

            byteOffset += 2; // because we read 16 bits (2 bytes).
        }

        if (payloadLen === 127) {
            const first32bits = buff.readUInt32BE(byteOffset);
            const second32bits = buff.readUInt32BE(byteOffset + 4);
          
            if (first32bits !== 0) {
              throw new Error('Payload with 8 byte length is not supported');
            }
          
            payloadLen = second32bits;
            byteOffset += 8; // because we read 64 bits (8 bytes).
        }

        let maskingKey = Buffer.alloc(4);
        if (mask) {
            maskingKey = buff.slice(byteOffset, byteOffset + 4);
            byteOffset += 4; // because we read 4 bytes.
        }

        const rawPayload = buff.slice(byteOffset); // we basically read remaining part of buffer
        const payload = mask ? unmask(rawPayload, payloadLen, maskingKey) : rawPayload;

        const frame: IFrame = {
            fin,
            rsv1,
            rsv2,
            rsv3,
            opcode,
            mask,
            payloadLen,
            payload,
            frameLen: byteOffset + payload.byteLength,
          }

        console.log(frame.payload.toString('utf-8'));
    })
});

server.listen(8080);
```

Let's test our WebSocket server - connect to server with browser dev tools.

![image](https://user-images.githubusercontent.com/43048524/168587204-e7dbf48d-002a-43d2-ae40-c50b6386158c.png)

Server:

![image](https://user-images.githubusercontent.com/43048524/168587454-0c40c622-5fd5-41a7-b8f3-0b916efb9922.png)


Everything looks fine. What we did wrong? Okay, let's send many messages in short amount of time.

![image](https://user-images.githubusercontent.com/43048524/168587743-0ecc3dfa-9714-4ef7-84dd-37b002903b41.png)

Server:

![image](https://user-images.githubusercontent.com/43048524/168587862-444c854e-469d-47c3-bbb6-b06f938287af.png)

#### Where our second message?
Add `console.log(buff)` and observe Buffer value;
```ts
const server = new Server((req, res) => {
    const wsKey = req.headers['sec-websocket-key'];
    const wsAcceptKey = createWsAcceptKey(wsKey!);
    finalizeHandshake(res, wsAcceptKey);
     
    // We have to reuse socket from HTTP request. Now we can operate on TCP level
    req.socket.on('data', (buff) => {
        console.log(buff);
        let byteOffset = 0;
        const firstByte = buff.readUint8(byteOffset);
 ```
 
 Client:
 
 ![image](https://user-images.githubusercontent.com/43048524/168588732-6c6e5593-8c90-4848-a0fe-a62dea283ff2.png)

Server:
 
 ![image](https://user-images.githubusercontent.com/43048524/168588600-11847f11-0c06-466d-a886-84e10102c11e.png)

#### Explanation
Web browser to send TCP packets uses Nagle's algorithm (https://en.wikipedia.org/wiki/Nagle%27s_algorithm) - for better efficiency.

Lets assume both WS frames have 17 byte size.
Every TCP packet has 40-byte header.

If browser send each frame as seperate packet - it will transfer 57 + 57 = 114 bytes.

If browser send both frames in one packet - it will transfer 57+17=74 bytes.

#### Let's fix that problem
1. Create class `WebsocketParser` - copy and paste parsing code to `readFrame` method and make a few changes.
```ts
class WebsocketParser {
  parsedFrames: IFrame[] = [];
  
  public readFrame(buff: Buffer) {
    let byteOffset = 0;
    const firstByte = buff.readUint8(byteOffset);
    
    ....
    
    const rawPayload = buff.slice(byteOffset, byteOffset+payloadLen); // read buffer ONLY from byteOffset to payloadLen. 
    const remainingBuff = buff.slice(byteOffset+payloadLen); // reamaining buffer - maybe our second frame?
    const payload = mask ? unmask(rawPayload, payloadLen, maskingKey) : rawPayload;

    const frame: IFrame = {
      fin,
      rsv1,
      rsv2,
      rsv3,
      opcode,
      mask,
      payloadLen,
      payload,
      frameLen: byteOffset + payload.byteLength,
    }

    this.parsedFrames.push(frame);
    
    return remainingBuff;
  }
}

```

2. Update our `data` handler
```ts
const server = new Server((req, res) => {
    const wsKey = req.headers['sec-websocket-key'];
    const wsAcceptKey = createWsAcceptKey(wsKey!);
    finalizeHandshake(res, wsAcceptKey);

    const parser = new WebsocketParser();

    req.socket.on('data', (buff) => {
        let remainingBuff = parser.readFrame(buff);
        
        while (remainingBuff.byteLength > 0) {
            remainingBuff = parser.readFrame(remainingBuff);
        }

        for (const frame of parser.parsedFrames) {
            console.log(frame.payload.toString('utf-8'));
        }
        
        parser.parsedFrames = [];
    })
});
```

3. Test

Client:

![image](https://user-images.githubusercontent.com/43048524/168601640-e29abd3a-c5ad-451c-b30f-0685820395c9.png)

Server:

![image](https://user-images.githubusercontent.com/43048524/168601561-e5dc15dc-417e-4655-b47f-066c462a1836.png)

