import SwiftUI
import MapKit

struct BridgeMapView: View {
    let state: BridgeState

    @State private var camera: MapCameraPosition

    init(state: BridgeState) {
        self.state = state
        let lat = state.metadata.lat ?? 25.770124
        let lon = state.metadata.lon ?? -80.190208
        let coord = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        _camera = State(initialValue: .region(
            MKCoordinateRegion(center: coord,
                               span: MKCoordinateSpan(latitudeDelta: 0.008, longitudeDelta: 0.008))
        ))
    }

    private var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(
            latitude: state.metadata.lat ?? 25.770124,
            longitude: state.metadata.lon ?? -80.190208
        )
    }

    var body: some View {
        Map(position: $camera) {
            Annotation("Brickell Bridge", coordinate: coordinate) {
                Image(systemName: state.status.symbolName)
                    .font(.title)
                    .foregroundStyle(state.status.isTrafficStopped ? .red : .green)
                    .padding(6)
                    .background(.regularMaterial, in: .circle)
            }
        }
        .frame(height: 220)
        .clipShape(.rect(cornerRadius: 14))
        .overlay(alignment: .topTrailing) {
            Button {
                let place = MKPlacemark(coordinate: coordinate)
                let item = MKMapItem(placemark: place)
                item.name = "Brickell Avenue Bridge"
                item.openInMaps()
            } label: {
                Image(systemName: "arrow.up.right.square.fill")
                    .font(.title2)
                    .foregroundStyle(.primary, .regularMaterial)
            }
            .padding(10)
            .accessibilityLabel("Open in Maps")
        }
    }
}
