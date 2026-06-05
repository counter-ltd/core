/**
 Login form: accepts username or email address plus password.

 Error messages come from the API response (e.g. "Invalid credentials") and
 are shown inline below the form. The submit button is disabled while loading.
 */

import SwiftUI

struct LoginView: View {
    @Environment(\.counterTheme) private var theme
    @Bindable var vm: AuthViewModel

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            ScrollView {
                VStack(spacing: CounterSpacing.xl) {
                    Spacer(minLength: 40)

                    // Wordmark
                    Text("counter")
                        .font(.system(size: 32, weight: .light, design: .monospaced))
                        .foregroundStyle(theme.text)

                    VStack(spacing: CounterSpacing.md) {
                        TextField("Username or email", text: $vm.identifier)
                            .textContentType(.username)
                            .autocapitalization(.none)
                            .autocorrectionDisabled()
                            .counterInput()

                        SecureField("Password", text: $vm.password)
                            .textContentType(.password)
                            .counterInput()

                        if let error = vm.errorMessage {
                            Text(error)
                                .font(CounterFont.body(13))
                                .foregroundStyle(theme.danger)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        Button {
                            Task { await vm.submit() }
                        } label: {
                            if vm.isLoading {
                                ProgressView()
                                    .tint(.black)
                            } else {
                                Text("Sign in")
                            }
                        }
                        .counterPrimaryButton(isLoading: vm.isLoading)
                        .disabled(vm.isLoading)
                    }
                    .padding(.horizontal, CounterSpacing.xl)

                    NavigationLink("Create an account") {
                        // Carry the same completion through so registering a second
                        // account from the add-account sheet also dismisses it.
                        RegisterView(vm: AuthViewModel(env: vm.env, mode: .register, onAuthenticated: vm.onAuthenticated))
                    }
                    .font(CounterFont.mono(13))
                    .foregroundStyle(theme.accent)
                }
            }
        }
        .navigationTitle("")
        .navigationBarHidden(true)
        .onSubmit { Task { await vm.submit() } }
    }
}
