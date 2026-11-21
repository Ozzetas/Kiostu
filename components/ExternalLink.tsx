import { Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { Platform } from 'react-native';

import { Logger } from '@/src/core/logging/Logger';

const logger = new Logger('ExternalLink');

type LinkProps = React.ComponentProps<typeof Link>;
// Extraigo únicamente las variantes string válidas de Href para compatibilizar expo-router con openBrowserAsync.
type ExternalHref = Extract<LinkProps['href'], string>;

export interface ExternalLinkProps extends Omit<LinkProps, 'href'> {
  readonly href: ExternalHref;
}

export function ExternalLink({ href, ...rest }: ExternalLinkProps) {
  return (
    <Link
      target="_blank"
      {...rest}
      href={href}
      onPress={(e) => {
        if (Platform.OS !== 'web') {
          e.preventDefault();
          WebBrowser.openBrowserAsync(href).catch((error: unknown) => {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            logger.error('Fallo al abrir el enlace en el navegador embebido', normalizedError, {
              href,
            });
          });
        }
      }}
    />
  );
}