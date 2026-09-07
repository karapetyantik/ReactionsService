import { Metadata } from '@grpc/grpc-js';

/** Shared secret sent to internal gRPC servers (e.g. ChatService's ChatInternal) that gate access via InternalGrpcAuthGuard. */
export function buildInternalGrpcMetadata(internalApiKey: string): Metadata {
  const metadata = new Metadata();
  metadata.set('x-internal-key', internalApiKey);
  return metadata;
}
