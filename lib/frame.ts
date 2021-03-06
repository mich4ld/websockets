import { ClosureStatus } from "./constants";
import { WebSocketError } from "./errors";
import { ICreateFrameOptions, IFrame, IFragmentedFrame } from "./interfaces";

function generateFirstByte(options: ICreateFrameOptions): number {
    const { opcode, fin } = options;

    if (opcode === 0x1 && fin) {
        return 129;
    }

    if (opcode === 0x1 && !fin) {
        return 1;
    }

    if (opcode === 0x2 && fin) {
        return 130;
    }

    return 2;
}


export class WebsocketParser {
    private parsedFrames: IFrame[] = []; 
    private fragmentedFrame: IFragmentedFrame | undefined;

    get frames() {
        return this.parsedFrames;
    }

    clearFrames() {
        this.parsedFrames = [];
    }

    public createFrame(payload: Buffer, options: ICreateFrameOptions) {
        const dataLen = payload.byteLength;

        const firstByte = generateFirstByte(options); // 129;
        const payloadLen = dataLen === 126 ? 126 : dataLen;
        const frameSize = 2 + (dataLen === 126 ? 2: 0) + dataLen; 
    
        const rawFrame = Buffer.alloc(frameSize);
        rawFrame.writeUInt8(firstByte, 0);
        rawFrame.writeUInt8(payloadLen, 1);
        
        let byteOffset = 2;
        if (dataLen === 126) {
            rawFrame.writeUInt16BE(dataLen, byteOffset);
            byteOffset++;
        }
    
        for (let i = 0; i < dataLen; i++) {
            rawFrame.writeUInt8(payload[i], byteOffset);
            byteOffset++;
        }
    
        return rawFrame;
    }

    public readFrame(chunk: Buffer) {
        chunk = this.readFragmentedBuffer(chunk);
        if (chunk.byteLength <= 0) {
            return chunk;
        }

        // parsing first byte of frame:
        let byteOffset = 0;
        const firstByte = chunk.readUint8(byteOffset);
    
        const fin = Boolean((firstByte >> 7) & 0x1);
    
        const rsv1 = (firstByte >> 6) & 0x1;
        const rsv2 = (firstByte >> 5) & 0x1;
        const rsv3 = (firstByte >> 4) & 0x1;

        if (rsv1 !== 0 || rsv2 !== 0 || rsv3 !== 0) {
            throw new WebSocketError(ClosureStatus.PROTOCOL_ERROR);
        }
    
        const opcode = firstByte & 15;
        
        // parsing second byte of frame:
        byteOffset++;
        const secondByte = chunk.readUInt8(byteOffset);
    
        const mask = Boolean((secondByte >> 7) & 0x1);
        let payloadLen = secondByte & 127;
    
        // parsing another bytes of frame:
        byteOffset++;
    
        if (payloadLen === 126) {
            payloadLen = chunk.readUint16BE(byteOffset);
    
            byteOffset += 2; // because we read 16 bits (2 bytes).
        }
    
        if (payloadLen === 127) {
            const first32bits = chunk.readUInt32BE(byteOffset);
            const second32bits = chunk.readUInt32BE(byteOffset + 4);
    
            if (first32bits !== 0) {
                throw new Error('Payload with 8 byte length is not supported');
            }
    
            payloadLen = second32bits;
            byteOffset += 8; // because we read 64 bits (8 bytes).
        }
    
        let maskingKey = Buffer.alloc(4);
        if (mask) {
            maskingKey = chunk.slice(byteOffset, byteOffset + 4) 
            byteOffset += 4; // because we read 4 bytes.
        }
    
        const rawPayload = chunk.slice(byteOffset, byteOffset+payloadLen);
        const remainingBuff = chunk.slice(byteOffset+payloadLen);
        
        if (rawPayload.byteLength < payloadLen) { 
            this.fragmentedFrame = {
                fin,
                rsv1,
                rsv2,
                rsv3,
                mask,
                opcode,
                payloadLen,
                rawPayload,
                maskingKey,
                byteOffset,
            }
    
            return Buffer.alloc(0);
        }
    
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

    public readFragmentedBuffer(chunk: Buffer) {
        if (!this.fragmentedFrame) {
            return chunk;
        }

        const remainingByteLen = this.fragmentedFrame.payloadLen - this.fragmentedFrame.rawPayload.byteLength;

        if (remainingByteLen > chunk.byteLength) {
            this.fragmentedFrame.rawPayload = Buffer.concat(
                [this.fragmentedFrame.rawPayload, chunk],
                this.fragmentedFrame.rawPayload.byteLength + chunk.byteLength,
            );

            return Buffer.alloc(0);
        }

        const remainingPart = chunk.slice(0, remainingByteLen);
        this.fragmentedFrame.rawPayload = Buffer.concat(
            [this.fragmentedFrame.rawPayload, remainingPart],
            this.fragmentedFrame.rawPayload.byteLength + remainingByteLen,
        );

        const payload = this.fragmentedFrame.mask ? unmask(
            this.fragmentedFrame.rawPayload,
            this.fragmentedFrame.payloadLen,
            this.fragmentedFrame.maskingKey,
        ) : this.fragmentedFrame.rawPayload;

        const frame: IFrame = {
            fin: this.fragmentedFrame.fin,
            rsv1: this.fragmentedFrame.rsv1,
            rsv2: this.fragmentedFrame.rsv2,
            rsv3: this.fragmentedFrame.rsv3,
            opcode: this.fragmentedFrame.opcode,
            mask: this.fragmentedFrame.mask,
            payload,
            payloadLen: this.fragmentedFrame.payloadLen,
            frameLen: this.fragmentedFrame.byteOffset + payload.byteLength,
        }

        this.parsedFrames.push(frame);
        this.fragmentedFrame = undefined;

        return chunk.slice(remainingByteLen);
    }
}

export function unmask(rawPayload: Buffer, payloadLen: number, maskingKey: Buffer) {
    const payload = Buffer.alloc(payloadLen);
    
    for (let i = 0; i < payloadLen; i++) {
        const j = i % 4;
        const decoded = rawPayload[i] ^ (maskingKey[j]);

        payload.writeUInt8(decoded, i);
    }

    return payload;
}