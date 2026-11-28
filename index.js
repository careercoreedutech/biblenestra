// App entry (package.json "main"). Boot applies the saved Light / Dark / System appearance, then renders App.
import { registerRootComponent } from 'expo';
import Boot from './src/boot/Boot';

registerRootComponent(Boot);
